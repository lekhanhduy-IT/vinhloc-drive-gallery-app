/* Authoritative folder thumbnail reference, stored on the folder itself.
   Requires the existing verified Google session; never exposes public Drive links. */
import {verifiedAccount,serverDriveToken} from './media.js';

const API='https://www.googleapis.com/drive/v3/files';
const DRIVE='0AMLRHzF05fTFUk9PVA';
const FOLDER='application/vnd.google-apps.folder';
const COVER_KEY='vlCoverImageId';
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
export const config={maxDuration:60};
function respond(res,code,message,extra={}){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(code).json({success:code<400,message,...extra});
}
async function google(url,token,init={}){
  const response=await fetch(url,{...init,headers:{
    Authorization:'Bearer '+token,...(init.headers||{})
  }});
  if(!response.ok)throw Object.assign(new Error('Drive HTTP '+response.status),{status:response.status});
  return response.json();
}
async function file(id,token,fields='id,name,mimeType,driveId,trashed,parents,appProperties'){
  if(!idOK(id))throw Object.assign(new Error('ID không hợp lệ'),{status:400});
  return google(API+'/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields='+encodeURIComponent(fields),token);
}
function valid(item,type){
  return item&&item.driveId===DRIVE&&item.trashed!==true&&
    (type==='folder'?item.mimeType===FOLDER:item.mimeType?.startsWith('image/'));
}
async function inShareScope(id,root,token){
  if(!root)return true;
  const visited=new Set();
  let next=id;
  for(let n=0;n<45;n++){
    if(next===root)return true;
    if(visited.has(next))return false;
    visited.add(next);
    const item=await file(next,token,'id,parents,driveId,trashed');
    if(item.trashed||item.driveId!==DRIVE)return false;
    if(item.parents?.includes(root))return true;
    if(item.parents?.length!==1)return false;
    next=item.parents[0];
  }
  return false;
}
export default async function handler(req,res){
  if(req.method!=='POST')return respond(res,405,'Chỉ hỗ trợ POST');
  const origin=req.headers.origin;
  if(origin){
    try{if(new URL(origin).host!==req.headers.host)return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
    catch(_){return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
  }
  let account;
  try{account=await verifiedAccount(req);}
  catch(_){return respond(res,401,'Cần đăng nhập Google để quản lý thumbnail');}
  // Only members can edit folder information; external share recipients
  // cannot mutate folders, even when they uploaded content inside the share.
  if(account.scopeRoot&&account.member!==true)
    return respond(res,403,'Tài khoản không có quyền sửa thông tin folder');
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  const action=String(body.action||'');
  try{
    const token=await serverDriveToken();
    if(action==='get'){
      const ids=body.folderIds;
      if(!Array.isArray(ids)||ids.length>80||ids.some(id=>!idOK(id)))
        return respond(res,400,'Danh sách thư mục không hợp lệ (tối đa 80)');
      const unique=[...new Set(ids)];
      const result={};let index=0;
      await Promise.all(Array.from({length:Math.min(6,unique.length)},async()=>{
        while(index<unique.length){
          const id=unique[index++];
          try{
            if(!await inShareScope(id,account.scopeRoot||null,token))continue;
            const info=await file(id,token);
            if(!valid(info,'folder'))continue;
            const imageId=info.appProperties?.[COVER_KEY];
            result[id]=idOK(imageId)?imageId:null;
          }catch(_){/* Unknown or inaccessible IDs are excluded, not trusted. */}
        }
      }));
      return respond(res,200,'OK',{covers:result});
    }
    if(action==='set'){
      const folderId=String(body.folderId||'');
      const imageId=String(body.imageId||'');
      if(!idOK(folderId)||!idOK(imageId))return respond(res,400,'ID ảnh hoặc thư mục không hợp lệ');
      if(!await inShareScope(folderId,account.scopeRoot||null,token))
        return respond(res,403,'Thư mục nằm ngoài phạm vi được chia sẻ');
      const [folder,image]=await Promise.all([file(folderId,token),file(imageId,token)]);
      if(!valid(folder,'folder')||!valid(image,'image')||!image.parents?.includes(folderId))
        return respond(res,400,'Chỉ được chọn ảnh nằm trực tiếp trong thư mục này');
      const properties={...(folder.appProperties||{}),[COVER_KEY]:imageId};
      const written=await google(API+'/'+encodeURIComponent(folderId)+
        '?supportsAllDrives=true&fields=id,appProperties',token,{
          method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},
          body:JSON.stringify({appProperties:properties})
        });
      if(written.appProperties?.[COVER_KEY]!==imageId)
        return respond(res,502,'Drive chưa xác nhận lưu thumbnail');
      return respond(res,200,'Đã lưu thumbnail trên Drive',{folderId,imageId});
    }
    return respond(res,400,'Thao tác không hỗ trợ');
  }catch(error){
    const status=error.status===400?400:error.status===403?403:
      error.status===404?404:502;
    return respond(res,status,'Không thể lưu/đọc thumbnail trên Drive: '+error.message);
  }
}
