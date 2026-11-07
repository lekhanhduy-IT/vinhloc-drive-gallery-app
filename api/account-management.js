/* Admin-only Shared Drive membership manager.
   The real ACL lives in Google Drive, not in browser localStorage. */
import {createHash} from 'node:crypto';
import {Redis} from '@upstash/redis';
import {verifiedAccount,serverDriveToken} from './media.js';
import {PRIMARY_ADMIN,normalizeAccountEmail,driveMembers,memberForEmail,appRole,
  invalidateMembers,driveRequest,permissionsUrl,sharedDrivePermissionsUrl} from '../lib/drive-roles.js';

export const config={maxDuration:60};
let redis=null;
try{redis=Redis.fromEnv();}catch(_){/* Presence requires configured Upstash. */}
function respond(res,status,message,extra={}){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json({success:status<400,message,...extra});
}
const presenceKey=email=>'vl:gallery:presence:v1:'+createHash('sha256').update(email).digest('hex');
async function pulse(email){
  if(!redis)return;
  await redis.set(presenceKey(email),{at:Date.now()},{ex:100});
}
async function status(email){
  if(!redis)return {online:null,lastSeen:null};
  try{
    const item=await redis.get(presenceKey(email));
    const at=Number(item?.at||0);
    return {online:at>0 && Date.now()-at<75000,lastSeen:at||null};
  }catch(_){return {online:null,lastSeen:null};}
}
export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return respond(res,405,'Phương thức không được hỗ trợ');
  const origin=req.headers.origin;
  if(origin){
    try{if(new URL(origin).host!==req.headers.host)return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
    catch(_){return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
  }
  let identity;
  try{identity=await verifiedAccount(req);}
  catch(_){return respond(res,401,'Cần đăng nhập lại bằng tài khoản Google được cấp quyền');}
  const email=normalizeAccountEmail(identity.email);
  if(!email)return respond(res,401,'Danh tính Google không hợp lệ');
  const scoped=!!identity.scopeRoot;
  const admin=!scoped && identity.role==='admin';
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  const action=req.method==='GET'?String(req.query.action||'me'):String(body.action||'heartbeat');
  if(action==='me')return respond(res,200,'OK',{email,role:scoped?'guest':identity.role,
    scopeRoot:identity.scopeRoot||null,admin});
  if(action==='heartbeat'){
    if(req.method!=='POST')return respond(res,405,'Sử dụng POST');
    if(!scoped && identity.role!=='guest'){
      try{await pulse(email);}catch(_){}
    }
    return respond(res,200,'OK',{email,role:scoped?'guest':identity.role,admin});
  }
  if(!admin)return respond(res,403,'Chỉ Admin đã xác minh mới được quản lý tài khoản');
  if(action==='list'){
    if(req.method!=='GET')return respond(res,405,'Sử dụng GET');
    try{
      const accounts=await driveMembers(await serverDriveToken());
      const rows=await Promise.all(accounts.map(async p=>({
        permissionId:p.id,email:p.emailAddress,displayName:p.displayName||'',
        role:appRole(p),
        driveRole:p.role,
        ...(await status(p.emailAddress))
      })));
      rows.sort((a,b)=>a.role===b.role?a.email.localeCompare(b.email):
        a.role==='admin'?-1:1);
      return respond(res,200,'OK',{accounts:rows,presenceAvailable:!!redis});
    }catch(error){return respond(res,502,'Không đọc được thành viên Shared Drive: '+error.message);}
  }
  if(req.method!=='POST')return respond(res,405,'Sử dụng POST');
  if(!['upsert','remove'].includes(action))return respond(res,400,'Thao tác không hợp lệ');
  const target=normalizeAccountEmail(body.email);
  if(!target)return respond(res,400,'Vui lòng nhập địa chỉ Gmail hợp lệ');
  if(action==='remove'&&(target===PRIMARY_ADMIN||target===email))
    return respond(res,403,'Không thể xóa Admin gốc hoặc tự thu hồi quyền của mình');
  if(action==='upsert'&&target===email)
    return respond(res,403,'Không thể tự thay đổi quyền Admin của mình');
  try{
    const token=await serverDriveToken();
    // Membership mutations on a shared drive are serialized by Google.
    const present=await memberForEmail(target,token,{fresh:true});
    if(action==='upsert'){
      if(!['member','admin'].includes(body.role))return respond(res,400,'Vai trò không hợp lệ');
      const driveRole=body.role==='admin'?'organizer':'fileOrganizer';
      if(target===PRIMARY_ADMIN&&driveRole!=='organizer')
        return respond(res,403,'Không thể hạ quyền Admin gốc');
      let permission=present;
      if(!present){
        permission=await driveRequest(sharedDrivePermissionsUrl+
          '?supportsAllDrives=true&sendNotificationEmail=true&fields=id,role,emailAddress',token,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({type:'user',role:driveRole,emailAddress:target})
        });
      }else if(present.role!==driveRole){
        permission=await driveRequest(permissionsUrl(present.id),token,{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({role:driveRole})
        });
      }
      invalidateMembers();
      return respond(res,200,'Đã cấp quyền trên Google Shared Drive',{
        email:target,role:body.role,permissionId:permission?.id||present?.id
      });
    }
    if(!present)return respond(res,404,'Tài khoản không còn trong bộ nhớ dùng chung');
    if(body.permissionId && body.permissionId!==present.id)
      return respond(res,409,'Mã tài khoản không còn khớp, hãy tải lại danh sách');
    await driveRequest(permissionsUrl(present.id),token,{method:'DELETE'});
    invalidateMembers();
    return respond(res,200,'Đã thu hồi quyền Shared Drive',{email:target,removed:true});
  }catch(error){
    const statusCode=error.status===403?403:502;
    return respond(res,statusCode,'Google Drive từ chối thay đổi quyền: '+error.message);
  }
}
