/* Authenticated direct-child image listing for choosing a folder cover.
   No public Drive links; browsers fetch thumbnails through /api/media. */
import {verifiedAccount,serverDriveToken} from './media.js';

const DRIVE_ID='0AMLRHzF05fTFUk9PVA';
const DRIVE_API='https://www.googleapis.com/drive/v3/files';
const idOk=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
const respond=(res,status,message,extra={})=>res.status(status).json({success:status<400,message,...extra});
export const config={maxDuration:60};

async function driveJson(url,token){
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Object.assign(new Error('Google Drive HTTP '+response.status),{status:response.status});
  return response.json();
}
async function file(id,token,fields='id,parents,mimeType,driveId,trashed'){
  return driveJson(DRIVE_API+'/'+encodeURIComponent(id)+
    '?supportsAllDrives=true&fields='+encodeURIComponent(fields),token);
}
async function inShareTree(id,root,token){
  if(!root)return true;
  const seen=new Set();
  let cursor=id;
  for(let depth=0;depth<45;depth++){
    if(cursor===root)return true;
    if(seen.has(cursor))return false;
    seen.add(cursor);
    const meta=await file(cursor,token,'id,parents,driveId,trashed');
    if(meta.trashed||meta.driveId!==DRIVE_ID)return false;
    const parents=meta.parents||[];
    if(parents.includes(root))return true;
    if(parents.length!==1)return false;
    cursor=parents[0];
  }
  return false;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return respond(res,405,'Phương thức không được hỗ trợ');
  const id=String(req.query.folderId||'');
  const page=String(req.query.pageToken||'');
  if(!idOk(id)||page.length>2048)return respond(res,400,'Tham số thư mục không hợp lệ');
  let user;
  try{user=await verifiedAccount(req);}
  catch(_){return respond(res,401,'Cần đăng nhập Google để chọn ảnh bìa');}
  // Folder-information editing is available to internal members only.
  if(user.scopeRoot && user.member!==true)
    return respond(res,403,'Không có quyền chỉnh sửa ảnh bìa thư mục');
  try{
    const token=await serverDriveToken();
    if(!await inShareTree(id,user.scopeRoot||null,token))
      return respond(res,403,'Thư mục nằm ngoài phạm vi được chia sẻ');
    const folder=await file(id,token);
    if(folder.trashed||folder.driveId!==DRIVE_ID||
      folder.mimeType!=='application/vnd.google-apps.folder')
      return respond(res,404,'Không tìm thấy thư mục hợp lệ');
    const params=new URLSearchParams({
      q:"'"+id+"' in parents and trashed=false and mimeType contains 'image/'",
      corpora:'drive',driveId:DRIVE_ID,
      includeItemsFromAllDrives:'true',supportsAllDrives:'true',
      pageSize:'100',fields:'nextPageToken,files(id,name,mimeType,parents,driveId,trashed)',
      ...(page?{pageToken:page}:{})
    });
    const listing=await driveJson(DRIVE_API+'?'+params,token);
    const images=(listing.files||[]).filter(item=>
      idOk(item.id)&&item.mimeType?.startsWith('image/')&&
      item.driveId===DRIVE_ID&&!item.trashed&&
      Array.isArray(item.parents)&&item.parents.includes(id)
    ).map(({id,name,mimeType})=>({id,name,mimeType}));
    return respond(res,200,'OK',{folderId:id,images,nextPageToken:listing.nextPageToken||''});
  }catch(error){
    const status=error.status===404?404:error.status===403?403:502;
    return respond(res,status,'Không thể đọc ảnh trong thư mục này');
  }
}
