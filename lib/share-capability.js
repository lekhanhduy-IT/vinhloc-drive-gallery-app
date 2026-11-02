import {createHmac,timingSafeEqual} from 'node:crypto';
const prefix='vlsg1';
const context='vinhloc/gallery-share/folder/v1';
function secret(){
  const raw=process.env.MEDIA_SESSION_SECRET||process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!raw)throw Error('Máy chủ chưa cấu hình khóa bảo mật liên kết chia sẻ');
  return createHmac('sha256',raw).update(context).digest();
}
export function signFolderGrant(folderId){
  if(!/^[A-Za-z0-9_-]{10,180}$/.test(folderId))throw Error('ID thư mục không hợp lệ');
  const payload=Buffer.from(JSON.stringify({root:folderId,exp:Math.floor(Date.now()/1000)+30*86400})).toString('base64url');
  const signature=createHmac('sha256',secret()).update(payload).digest('base64url');
  return prefix+'.'+payload+'.'+signature;
}
export function readFolderGrant(value){
  if(typeof value!=='string'||value.length>1024)return null;
  const parts=value.split('.');
  if(parts.length!==3||parts[0]!==prefix)return null;
  const payload=parts[1],signature=parts[2];
  const expected=createHmac('sha256',secret()).update(payload).digest();
  const actual=Buffer.from(signature,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  try {
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(typeof data.root!=='string'||!/^[A-Za-z0-9_-]{10,180}$/.test(data.root)||
       !Number.isSafeInteger(data.exp)||data.exp<=Math.floor(Date.now()/1000))return null;
    return data;
  }catch(_){return null;}
}
