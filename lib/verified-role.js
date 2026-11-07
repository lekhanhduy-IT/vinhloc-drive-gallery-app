/* Short-lived distributed ACL cache for high-volume thumbnail requests.
   A role change explicitly invalidates the target's key. Never accept role
   claims from the browser, and never cache a Drive API error as access. */
import {createHash} from 'node:crypto';
import {Redis} from '@upstash/redis';
import {roleForEmail,normalizeAccountEmail} from './drive-roles.js';

let redis=null;
try{redis=Redis.fromEnv();}catch(_){}
const TTL=25;
const prefix='vl:gallery:verified-role:v1:';
const key=email=>prefix+createHash('sha256').update(email).digest('hex');
const validRole=x=>x==='admin'||x==='member'||x==='guest';
const memory=new Map();
const active=new Map();
export async function invalidateVerifiedRole(value){
  const email=normalizeAccountEmail(value);
  if(!email)return;
  memory.delete(email);
  if(redis)try{await redis.del(key(email));}catch(_){}
}
export async function verifiedRole(value,tokenProvider,{fresh=false}={}){
  const email=normalizeAccountEmail(value);
  if(!email)return 'guest';
  if(!fresh){
    const local=memory.get(email);
    if(local&&local.until>Date.now())return local.role;
    if(redis){
      try{
        const cached=await redis.get(key(email));
        if(validRole(cached)){
          memory.set(email,{role:cached,until:Date.now()+5000});
          return cached;
        }
      }catch(_){}
    }
  }
  if(active.has(email))return active.get(email);
  const job=(async()=>{
    const role=await roleForEmail(email,await tokenProvider(),{fresh});
    memory.set(email,{role,until:Date.now()+5000});
    if(redis)try{await redis.set(key(email),role,{ex:TTL});}catch(_){}
    return role;
  })();
  active.set(email,job);
  try{return await job;}finally{if(active.get(email)===job)active.delete(email);}
}
