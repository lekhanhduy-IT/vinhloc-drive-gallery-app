/* Admin-only incremental cover assignment for the existing gallery tree.
   Browse DIRECT CHILDREN of one verified folder at a time; there is no
   Shared Drive-wide file listing. Preserve appProperties.vlCoverImageId. */
import {verifiedAccount,serverDriveToken} from './media.js';

export const config={maxDuration:60};
const DRIVE='0AMLRHzF05fTFUk9PVA';
const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const API='https://www.googleapis.com/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
const COVER='vlCoverImageId';
const isId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(value);
function respond(res,status,message,extra={}){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json({success:status<400,message,...extra});
}
async function google(url,token,init={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const result=await fetch(url,{...init,signal:controller.signal,cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(init.headers||{})}});
    if(!result.ok){
      const details=await result.json().catch(()=>({}));
      throw Object.assign(new Error(details.error?.message||'Google Drive HTTP '+result.status),{status:result.status});
    }
    return result.json();
  }finally{clearTimeout(timer);}
}
async function metadata(id,token,fields='id,name,parents,mimeType,driveId,trashed,appProperties'){
  if(!isId(id))throw Object.assign(new Error('Folder ID không hợp lệ'),{status:400});
  return google(API+'/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields='+
    encodeURIComponent(fields),token);
}
async function inGalleryTree(id,token){
  let cursor=id;
  const seen=new Set();
  for(let depth=0;depth<60;depth++){
    if(cursor===ROOT)return true;
    if(!isId(cursor)||cursor===DRIVE||seen.has(cursor))return false;
    seen.add(cursor);
    const node=await metadata(cursor,token,'id,parents,driveId,trashed,mimeType');
    if(node.trashed||node.driveId!==DRIVE||
       node.mimeType!==FOLDER||node.parents?.length!==1)return false;
    cursor=node.parents[0];
  }
  return false;
}
async function folderForGallery(id,token){
  if(!isId(id)||!await inGalleryTree(id,token))
    throw Object.assign(new Error('Folder ngoài phạm vi 06. HÌNH ẢNH CONTENT'),{status:403});
  const folder=await metadata(id,token);
  if(folder.trashed||folder.driveId!==DRIVE||folder.mimeType!==FOLDER)
    throw Object.assign(new Error('Folder đã xóa hoặc không tồn tại'),{status:404});
  return folder;
}
function browseUrl(folderId,pageToken){
  // Strictly one current folder: never use corpora=drive to scan everything.
  // Parent relationship and trashed filter are enforced by the Drive API.
  const q="'"+folderId+"' in parents and trashed = false and ("+
    "mimeType = '"+FOLDER+"' or mimeType contains 'image/')";
  const params=new URLSearchParams({
    q,corpora:'drive',driveId:DRIVE,includeItemsFromAllDrives:'true',
    supportsAllDrives:'true',pageSize:'250',
    fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,driveId,trashed,size,imageMediaMetadata(width,height))'
  });
  if(pageToken)params.set('pageToken',pageToken);
  return API+'?'+params.toString();
}
async function applyOne(folderId,imageId,overwrite,token){
  const folder=await folderForGallery(folderId,token);
  const existing=folder.appProperties?.[COVER];
  // User's existing selection always wins unless an explicit overwrite is on.
  if(isId(existing)&&!overwrite)return {folderId,status:'existing',imageId:existing};
  if(existing===imageId)return {folderId,status:'existing',imageId};
  const image=await metadata(imageId,token,'id,mimeType,parents,driveId,trashed');
  if(image.trashed||image.driveId!==DRIVE||
     !image.mimeType?.startsWith('image/')||
     !image.parents?.includes(folderId))
    return {folderId,status:'failed',message:'Ảnh không còn nằm trực tiếp trong folder'};
  const updated=await google(API+'/'+encodeURIComponent(folderId)+
    '?supportsAllDrives=true&fields=id,appProperties',token,{
      method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},
      body:JSON.stringify({appProperties:{...(folder.appProperties||{}),[COVER]:imageId}})
    });
  if(updated.appProperties?.[COVER]!==imageId)
    return {folderId,status:'failed',message:'Drive chưa xác nhận lưu thumbnail'};
  return {folderId,status:'written',imageId};
}
export default async function handler(req,res){
  if(req.method!=='POST')return respond(res,405,'Chỉ hỗ trợ POST');
  if(req.headers.origin){
    try{if(new URL(req.headers.origin).host!==req.headers.host)
      return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
    catch(_){return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
  }
  let identity;
  try{identity=await verifiedAccount(req);}
  catch(_){return respond(res,401,'Cần đăng nhập Google để quét thumbnail');}
  if(identity.scopeRoot||identity.role!=='admin')
    return respond(res,403,'Chỉ Admin được quét và lưu thumbnail hàng loạt');
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  try{
    const token=await serverDriveToken();
    if(body.action==='browse'){
      const folderId=String(body.folderId||'');
      const cursor=body.pageToken||'';
      if(typeof cursor!=='string'||cursor.length>2500)
        return respond(res,400,'Mã trang không hợp lệ');
      const folder=await folderForGallery(folderId,token);
      const result=await google(browseUrl(folderId,cursor),token);
      if(result.incompleteSearch)
        return respond(res,503,'Drive trả về dữ liệu chưa đầy đủ, hãy thử lại');
      const items=(result.files||[]).filter(x=>isId(x.id)&&
        x.driveId===DRIVE && !x.trashed && x.parents?.includes(folderId));
      return respond(res,200,'OK',{
        folderId,folderName:String(folder.name||'').slice(0,150),
        hasCover:isId(folder.appProperties?.[COVER]),
        items:items.map(x=>x.mimeType===FOLDER?
          {id:x.id,name:String(x.name||'').slice(0,180),kind:'folder'}:
          {id:x.id,name:String(x.name||'').slice(0,180),kind:'image',
            mimeType:x.mimeType,size:Number(x.size||0),
            width:Number(x.imageMediaMetadata?.width||0),
            height:Number(x.imageMediaMetadata?.height||0)}),
        nextPageToken:result.nextPageToken||null
      });
    }
    if(body.action==='apply'){
      const folderId=String(body.folderId||''),imageId=String(body.imageId||'');
      if(!isId(folderId)||!isId(imageId)||typeof body.overwrite!=='boolean')
        return respond(res,400,'Folder, ảnh hoặc tùy chọn không hợp lệ');
      return respond(res,200,'OK',{
        result:await applyOne(folderId,imageId,body.overwrite,token)
      });
    }
    // Deliberately reject legacy folders/images actions to prevent a browser
    // still using the previous release from continuing a full Drive scan.
    return respond(res,400,'Luồng quét cũ không còn hỗ trợ; hãy tải bản mới');
  }catch(error){
    return respond(res,[400,403,404,429].includes(error.status)?error.status:502,
      'Không xử lý được folder: '+String(error.message||error).slice(0,240));
  }
}
