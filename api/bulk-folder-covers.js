/* One-time bulk folder cover migration; mutations follow the same
   appProperties.vlCoverImageId contract as /api/folder-cover.
   Client owns a resumable cursor; each request is bounded for Vercel. */
import {verifiedAccount,serverDriveToken} from './media.js';

export const config={maxDuration:60};
const DRIVE='0AMLRHzF05fTFUk9PVA';
const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const API='https://www.googleapis.com/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
const COVER='vlCoverImageId';
const isId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(value);
function answer(res,status,message,extra={}){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json({success:status<400,message,...extra});
}
async function google(url,token,init={}){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,...(init.headers||{})}});
    if(!response.ok){
      const errorData=await response.json().catch(()=>({}));
      const error=new Error(errorData.error?.message||'Drive HTTP '+response.status);
      error.status=response.status;
      throw error;
    }
    return response.json();
  }finally{clearTimeout(t);}
}
function listUrl(kind,cursor){
  const q=kind==='folders'?"mimeType = '"+FOLDER+"' and trashed = false":
    "mimeType contains 'image/' and trashed = false";
  const params=new URLSearchParams({
    q,corpora:'drive',driveId:DRIVE,includeItemsFromAllDrives:'true',
    supportsAllDrives:'true',pageSize:'350',
    fields:kind==='folders'?
      'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,driveId,appProperties)':
      'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,driveId,size,imageMediaMetadata(width,height))'
  });
  if(cursor)params.set('pageToken',cursor);
  return API+'?'+params.toString();
}
async function metadata(id,token,fields){
  return google(API+'/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields='+
    encodeURIComponent(fields),token);
}
async function withinRoot(id,token,cache){
  let cursor=id;
  const seen=new Set(),chain=[];
  const finish=allowed=>{
    for(const id of chain)cache.set(id,allowed);
    return allowed;
  };
  for(let depth=0;depth<60;depth++){
    if(cursor===ROOT)return finish(true);
    if(!isId(cursor)||cursor===DRIVE||seen.has(cursor))return finish(false);
    if(cache.has(cursor))return finish(cache.get(cursor));
    seen.add(cursor);
    chain.push(cursor);
    const node=await metadata(cursor,token,'id,driveId,parents,trashed');
    if(node.trashed||node.driveId!==DRIVE||node.parents?.length!==1)return finish(false);
    cursor=node.parents[0];
  }
  return finish(false);
}
async function applyOne(item,token,overwrite,cache){
  const folderId=item.folderId,imageId=item.imageId;
  if(!isId(folderId)||!isId(imageId))return {folderId,status:'failed',message:'ID không hợp lệ'};
  try{
    if(!await withinRoot(folderId,token,cache))
      return {folderId,status:'failed',message:'Thư mục nằm ngoài kho ảnh của ứng dụng'};
    const [folder,image]=await Promise.all([
      metadata(folderId,token,'id,mimeType,driveId,parents,trashed,appProperties'),
      metadata(imageId,token,'id,mimeType,driveId,parents,trashed')
    ]);
    if(folder.trashed||folder.driveId!==DRIVE||folder.mimeType!==FOLDER)
      return {folderId,status:'failed',message:'Thư mục không còn tồn tại'};
    if(image.trashed||image.driveId!==DRIVE||
        !image.mimeType?.startsWith('image/')||!image.parents?.includes(folderId))
      return {folderId,status:'failed',message:'Ảnh không còn nằm trực tiếp trong folder'};
    const existing=folder.appProperties?.[COVER];
    // Re-read immediately before writing: manual user selections win by default.
    if(isId(existing)&&!overwrite)return {folderId,status:'existing',imageId:existing};
    if(existing===imageId)return {folderId,status:'existing',imageId};
    const updated=await google(API+'/'+encodeURIComponent(folderId)+
      '?supportsAllDrives=true&fields=id,appProperties',token,{
      method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},
      body:JSON.stringify({appProperties:{...(folder.appProperties||{}),[COVER]:imageId}})
    });
    if(updated.appProperties?.[COVER]!==imageId)
      throw new Error('Drive chưa xác nhận ID thumbnail');
    return {folderId,status:'written',imageId};
  }catch(error){
    return {folderId,status:'failed',message:String(error.message||error).slice(0,240)};
  }
}
export default async function handler(req,res){
  if(req.method!=='POST')return answer(res,405,'Chỉ hỗ trợ POST');
  const origin=req.headers.origin;
  if(origin){
    try{if(new URL(origin).host!==req.headers.host)return answer(res,403,'Nguồn yêu cầu không hợp lệ');}
    catch(_){return answer(res,403,'Nguồn yêu cầu không hợp lệ');}
  }
  let account;
  try{account=await verifiedAccount(req);}
  catch(_){return answer(res,401,'Cần đăng nhập Google để chạy hàm');}
  if(account.scopeRoot||account.role!=='admin')
    return answer(res,403,'Chỉ tài khoản Admin mới được chạy gán thumbnail hàng loạt');
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  const action=body.action;
  try{
    const token=await serverDriveToken();
    if(action==='folders'||action==='images'){
      if(body.pageToken!==undefined&&
        (typeof body.pageToken!=='string'||body.pageToken.length>2500))
        return answer(res,400,'Trang quét không hợp lệ');
      const list=await google(listUrl(action,body.pageToken||''),token);
      if(list.incompleteSearch)return answer(res,503,'Google Drive trả về danh sách chưa đầy đủ, hãy thử lại');
      const files=(list.files||[]).filter(x=>isId(x.id)&&x.driveId===DRIVE);
      return answer(res,200,'OK',{
        items:action==='folders'?
          files.map(x=>({id:x.id,name:String(x.name||'').slice(0,180),
            parentId:x.parents?.[0]||null,
            hasCover:isId(x.appProperties?.[COVER])})):
          files.filter(x=>x.mimeType?.startsWith('image/')).map(x=>({
            id:x.id,name:String(x.name||'').slice(0,180),
            parentId:x.parents?.[0]||null,mimeType:x.mimeType,
            size:Number(x.size||0),
            width:Number(x.imageMediaMetadata?.width||0),
            height:Number(x.imageMediaMetadata?.height||0)
          })),
        nextPageToken:list.nextPageToken||null
      });
    }
    if(action==='apply'){
      const items=body.items;
      if(!Array.isArray(items)||!items.length||items.length>4||
        items.some(x=>!x||!isId(x.folderId)||!isId(x.imageId)))
        return answer(res,400,'Mỗi lần chỉ xử lý tối đa 4 folder hợp lệ');
      if(typeof body.overwrite!=='boolean')
        return answer(res,400,'Cần chỉ định chế độ ghi đè');
      const cache=new Map();
      const result=[];
      // Sequential updates avoid bursts of Drive write quota and keep
      // each batch bounded in time, even for deeply nested folders.
      for(const item of items)result.push(await applyOne(item,token,body.overwrite,cache));
      return answer(res,200,'Đã xử lý một đợt',{results:result});
    }
    return answer(res,400,'Thao tác không hợp lệ');
  }catch(error){
    return answer(res,[400,403,404,429].includes(error.status)?error.status:502,
      'Google Drive không xử lý được đợt này: '+String(error.message||error).slice(0,240));
  }
}
