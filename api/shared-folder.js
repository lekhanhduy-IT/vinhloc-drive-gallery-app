import {verifiedAccount,serverDriveToken} from './media.js';
const DRIVE='0AMLRHzF05fTFUk9PVA';
const idOk=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
const API='https://www.googleapis.com/drive/v3/files';
export const config={maxDuration:60};
async function fetchDrive(url){
  const token=await serverDriveToken();
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Object.assign(new Error('Google Drive '+response.status),{status:response.status});
  return response.json();
}
async function file(id,fields){
  if(!idOk(id))throw Object.assign(new Error('ID không hợp lệ'),{status:400});
  return fetchDrive(API+'/'+encodeURIComponent(id)+
    '?supportsAllDrives=true&fields='+encodeURIComponent(fields));
}
async function underRoot(id,root){
  const visited=new Set();
  let pointer=id;
  for(let depth=0;depth<45;depth++){
    if(pointer===root)return true;
    if(visited.has(pointer))return false;
    visited.add(pointer);
    const info=await file(pointer,'id,parents,driveId,trashed');
    if(info.trashed||info.driveId!==DRIVE)return false;
    if((info.parents||[]).includes(root))return true;
    if(!Array.isArray(info.parents)||info.parents.length!==1)return false;
    pointer=info.parents[0];
  }
  return false;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({success:false,message:'Method not allowed'});
  const origin=req.headers.origin;
  if(origin){
    try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({success:false,message:'Nguồn khác'});}
    catch(_){return res.status(403).json({success:false,message:'Nguồn không hợp lệ'});}
  }
  let user;
  try{user=await verifiedAccount(req);}
  catch(_){return res.status(401).json({success:false,message:'Phải đăng nhập Google qua liên kết chia sẻ'});}
  if(!user.scopeRoot)return res.status(403).json({success:false,message:'Phiên không giới hạn chia sẻ không được dùng trên liên kết này'});
  const input=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const folderId=String(input.folderId||'');
  if(!idOk(folderId))return res.status(400).json({success:false,message:'ID thư mục không hợp lệ'});
  try{
    if(!await underRoot(folderId,user.scopeRoot))
      return res.status(403).json({success:false,message:'Không được đọc ngoài thư mục chia sẻ'});
    const folder=await file(folderId,'id,name,mimeType,driveId,trashed');
    if(folder.trashed||folder.driveId!==DRIVE||folder.mimeType!=='application/vnd.google-apps.folder')
      return res.status(403).json({success:false,message:'Thư mục không hợp lệ'});
    const list=[],pageSize=500;
    let page='',n=0;
    do{
      const p=new URLSearchParams({
        q:"'"+folderId+"' in parents and trashed=false",
        fields:'nextPageToken,files(id,name,mimeType,size,description,createdTime,appProperties,webViewLink)',
        pageSize:String(pageSize),supportsAllDrives:'true',includeItemsFromAllDrives:'true',
        ...(page?{pageToken:page}:{})
      });
      const raw=await fetchDrive(API+'?'+p);
      for(const f of raw.files||[]){
        const directory=f.mimeType==='application/vnd.google-apps.folder';
        list.push({
          id:f.id,name:f.name,
          type:directory?'folder':'file',
          mimeType:f.mimeType||'',
          description:f.description||'',
          size:Number(f.size||0),
          createdTime:f.createdTime,
          // Short-lived thumbnail URL is not needed. Media goes through
          // the scope-checked same-origin /api/media proxy.
          url:directory?'':'/api/media?fileId='+encodeURIComponent(f.id)+'&variant=full',
          uploadedBy:f.appProperties?.vlUploadedBy||null
        });
      }
      n++;
      page=raw.nextPageToken||'';
    }while(page&&n<30);
    if(page)return res.status(413).json({success:false,message:'Thư mục chứa quá nhiều mục để tải trong một lượt'});
    return res.status(200).json({success:true,data:list,root:user.scopeRoot});
  }catch(err){
    return res.status(err.status===404?404:502).json({success:false,message:'Không tải được thư mục chia sẻ'});
  }
}
