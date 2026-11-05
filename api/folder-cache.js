/* Shared, permission-checked folder list cache for instant follow-up visits.
   Redis stores only Drive metadata, never Google tokens or private media bytes.
   Cached data is partitioned by access scope, with an explicit staleness limit. */
import {Redis} from '@upstash/redis';
import {verifiedAccount,serverDriveToken} from './media.js';

export const config={maxDuration:60};
const redis=Redis.fromEnv();
const API='https://www.googleapis.com/drive/v3/files';
const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const SHARED_DRIVE='0AMLRHzF05fTFUk9PVA';
const FOLDER='application/vnd.google-apps.folder';
const ID=/^[A-Za-z0-9_-]{10,180}$/;
const DATA_TTL=48*3600;
const FRESH_MS=10*60*1000;
const MAX_PAGES=25;
const reply=(res,status,message,extra={})=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json({success:status<400,message,...extra});
};
const key=(root,id)=>'vl:folder:v2:'+root+':'+id;
const indexKey=root=>'vl:folder:v2:index:'+root;
async function getDrive(url,token){
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw Object.assign(new Error('Drive HTTP '+response.status),{status:response.status});
  return response.json();
}
async function verifyPath(id,root,isShare,token){
  if(!ID.test(id)||!ID.test(root))return false;
  const seen=new Set();
  let cursor=id;
  for(let depth=0;depth<48;depth++){
    if(seen.has(cursor))return false;
    seen.add(cursor);
    const info=await getDrive(API+'/'+encodeURIComponent(cursor)+
      '?supportsAllDrives=true&fields=id,mimeType,driveId,trashed,parents',token);
    if(info.trashed)return false;
    if(isShare&&info.driveId!==SHARED_DRIVE)return false;
    if(cursor===id&&info.mimeType!==FOLDER)return false;
    if(cursor===root)return true;
    if(!Array.isArray(info.parents)||info.parents.length!==1||!ID.test(info.parents[0]))return false;
    cursor=info.parents[0];
  }
  return false;
}
async function listFolder(id,token){
  const files=[];
  let page='',round=0;
  do{
    const query=new URLSearchParams({
      q:"'"+id+"' in parents and trashed = false",
      pageSize:'1000',supportsAllDrives:'true',
      includeItemsFromAllDrives:'true',corpora:'allDrives',
      fields:'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,description,appProperties,trashed)'
    });
    if(page)query.set('pageToken',page);
    const data=await getDrive(API+'?'+query,token);
    for(const f of data.files||[]){
      if(!ID.test(f.id)||f.trashed)continue;
      const folder=f.mimeType===FOLDER;
      files.push({
        id:f.id,name:String(f.name||'').slice(0,255),
        type:folder?'folder':'file',mimeType:f.mimeType||'',
        description:String(f.description||'').slice(0,1500),
        ...(folder?{}:{
          size:Number(f.size||0),
          createdTime:f.createdTime||'',
          modifiedTime:f.modifiedTime||'',
          url:f.webViewLink||'/api/media?fileId='+encodeURIComponent(f.id)+'&variant=full',
          uploadedBy:f.appProperties?.vlUploadedBy||null
        })
      });
    }
    page=data.nextPageToken||'';
    round++;
  }while(page&&round<MAX_PAGES);
  if(page)throw Object.assign(new Error('Thư mục quá lớn, danh sách không được lưu khi chưa đủ'),{status:413});
  files.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name,'vi'):a.type==='folder'?-1:1);
  return files;
}
export default async function handler(req,res){
  if(req.method!=='POST')return reply(res,405,'Chỉ hỗ trợ POST');
  if(req.headers.origin){
    try{
      if(new URL(req.headers.origin).host!==req.headers.host)return reply(res,403,'Nguồn không hợp lệ');
    }catch(_){return reply(res,403,'Nguồn không hợp lệ');}
  }
  let account;
  try{account=await verifiedAccount(req);}
  catch(_){return reply(res,401,'Cần đăng nhập Google để đọc cache dùng chung');}
  let data=typeof req.body==='string'?null:req.body;
  if(!data)try{data=JSON.parse(req.body||'{}');}catch(_){data={};}
  const scope=account.scopeRoot||ROOT;
  const share=!!account.scopeRoot;
  const action=String(data.action||'');
  if(!ID.test(scope))return reply(res,403,'Phạm vi chưa được cấp quyền');
  try{
    if(action==='snapshot'){
      // An external shared-folder account must never enumerate unrelated
      // cached folders. It can only request specific IDs within its scope.
      if(share)return reply(res,403,'Liên kết chia sẻ không hỗ trợ liệt kê toàn kho');
      const offset=Math.min(15000,Math.max(0,Number(data.offset)||0));
      const limit=Math.min(25,Math.max(1,Number(data.limit)||12));
      const all=(await redis.smembers(indexKey(scope))||[]).filter(x=>ID.test(x)).sort();
      const page=all.slice(offset,offset+limit);
      const values=page.length?await redis.mget(...page.map(id=>key(scope,id))):[];
      const entries=page.flatMap((id,i)=>values[i]&&Array.isArray(values[i].items)?
        [{id,items:values[i].items,updatedAt:values[i].updatedAt||0}]:[]);
      return reply(res,200,'OK',{entries,offset,nextOffset:offset+page.length,
        total:all.length,hasMore:offset+page.length<all.length});
    }
    if(!['get','warm'].includes(action))return reply(res,400,'Thao tác không hợp lệ');
    const id=String(data.folderId||'');
    if(!ID.test(id))return reply(res,400,'ID thư mục không hợp lệ');
    const token=await serverDriveToken();
    if(!await verifyPath(id,scope,share,token))
      return reply(res,403,'Không được đọc thư mục ngoài kho ảnh đã cấp quyền');
    const cacheKey=key(scope,id);
    let cached=await redis.get(cacheKey);
    if(cached&&Array.isArray(cached.items)&&
      (action==='get'||(!data.force&&Date.now()-Number(cached.updatedAt||0)<FRESH_MS))){
      return reply(res,200,'OK',{folderId:id,data:cached.items,
        updatedAt:cached.updatedAt,source:'shared-cache',
        fresh:Date.now()-Number(cached.updatedAt||0)<FRESH_MS});
    }
    const items=await listFolder(id,token);
    const updatedAt=Date.now();
    await redis.set(cacheKey,{items,updatedAt},{ex:DATA_TTL});
    await redis.sadd(indexKey(scope),id);
    return reply(res,200,'OK',{folderId:id,data:items,updatedAt,
      source:'drive',fresh:true});
  }catch(error){
    console.error('[folder-cache] ',error?.message||error);
    const status=[400,403,404,413,429].includes(error?.status)?error.status:503;
    return reply(res,status,status===503?
      'Cache dùng chung hoặc Drive tạm thời không khả dụng':
      String(error.message||'Lỗi đọc danh sách'));
  }
}