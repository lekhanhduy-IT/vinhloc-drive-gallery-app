/* Verified Drive search and physical ancestor path. Never trust stale
   browser caches or unverified metadata for search results. */
import {verifiedAccount,serverDriveToken} from './media.js';
const API='https://www.googleapis.com/drive/v3/files';
const DRIVE='0AMLRHzF05fTFUk9PVA';
const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const FOLDER='application/vnd.google-apps.folder';
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(x);
export const config={maxDuration:60};
const respond=(res,code,message,extra={})=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(code).json({success:code<400,message,...extra});
};
async function google(path,token){
  const response=await fetch(API+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Object.assign(new Error('Drive '+response.status),{status:response.status});
  return response.json();
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
  catch(_){return respond(res,401,'Cần đăng nhập Google trong QL Ảnh');}
  let body=typeof req.body==='string'?null:req.body;
  if(!body)try{body=JSON.parse(req.body||'{}');}catch(_){body={};}
  const action=String(body.action||'');
  const scope=account.scopeRoot||ROOT;
  if(!idOK(scope))return respond(res,403,'Phạm vi Drive không hợp lệ');
  try {
    const token=await serverDriveToken();
    const memo=new Map();
    async function file(id){
      if(!idOK(id))throw Object.assign(new Error('ID không hợp lệ'),{status:400});
      if(!memo.has(id))memo.set(id,google('/'+encodeURIComponent(id)+
        '?supportsAllDrives=true&fields=id,name,mimeType,driveId,trashed,parents',token));
      return memo.get(id);
    }
    // Verify EVERY ancestor; a descendant of a trashed folder is excluded
    // even if that descendant's own 'trashed' field is false.
    async function pathFor(id){
      const seen=new Set(),reversed=[];
      for(let depth=0;depth<50;depth++){
        if(seen.has(id))return null;
        seen.add(id);
        const item=await file(id);
        if(item.trashed||item.driveId!==DRIVE||!idOK(item.id))return null;
        reversed.push(item);
        if(id===scope)return [...reversed].reverse();
        const parents=item.parents||[];
        if(parents.length!==1||!idOK(parents[0]))return null;
        id=parents[0];
      }
      return null;
    }
    if(action==='path'){
      const id=String(body.folderId||'');
      if(!idOK(id))return respond(res,400,'ID thư mục không hợp lệ');
      const path=await pathFor(id);
      if(!path || path[path.length-1].mimeType!==FOLDER)
        return respond(res,404,'Không tìm thấy đường dẫn thư mục còn hoạt động');
      return respond(res,200,'OK',{folderId:id,
        path:path.map(x=>({id:x.id,name:String(x.name||'Thư mục').slice(0,250)})),
        scopeRoot:scope});
    }
    if(action==='search'){
      const keyword=String(body.keyword||'').trim();
      if(keyword.length<1||keyword.length>150)return respond(res,400,'Từ khóa tìm kiếm không hợp lệ');
      // Google Drive name search is case-insensitive. Escaping keeps a user
      // keyword data-only, never part of the Drive query expression.
      const literal=keyword.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const result=[],seen=new Set();
      let page='',round=0;
      // Search the shared drive, then scope/filter verified candidates.
      // Keep bounded costs for large libraries.
      do{
        const params=new URLSearchParams({
          q:"name contains '"+literal+"' and trashed = false",
          corpora:'drive',driveId:DRIVE,
          includeItemsFromAllDrives:'true',supportsAllDrives:'true',
          pageSize:'100',
          fields:'nextPageToken,files(id,name,mimeType,driveId,trashed,parents,size,createdTime)'
        });
        if(page)params.set('pageToken',page);
        const listing=await google('?'+params,token);
        const candidates=(listing.files||[]).filter(x=>
          idOK(x.id)&&x.driveId===DRIVE&&!x.trashed&&!seen.has(x.id));
        for(const item of candidates){seen.add(item.id);memo.set(item.id,Promise.resolve(item));}
        let next=0;
        await Promise.all(Array.from({length:Math.min(8,candidates.length)},async()=>{
          while(next<candidates.length){
            const item=candidates[next++];
            try{
              if(!await pathFor(item.id))continue;
              const isFolder=item.mimeType===FOLDER;
              result.push({
                id:item.id,name:String(item.name||'').slice(0,250),
                type:isFolder?'folder':'file',mimeType:item.mimeType||'',
                size:Number(item.size||0),createdTime:item.createdTime||null,
                ...(!isFolder?{url:'/api/media?fileId='+encodeURIComponent(item.id)+'&variant=full'}:{})
              });
            }catch(_){/* inaccessible/missing ancestors are not searchable */}
          }
        }));
        page=listing.nextPageToken||'';
        round++;
      }while(page&&round<5&&result.length<150);
      result.sort((a,b)=>a.type===b.type?
        a.name.localeCompare(b.name,'vi'):a.type==='folder'?-1:1);
      return respond(res,200,'OK',{items:result.slice(0,150),hasMore:!!page});
    }
    return respond(res,400,'Thao tác không được hỗ trợ');
  }catch(error){
    const status=error.status===400?400:error.status===403?403:
      error.status===404?404:502;
    return respond(res,status,'Không đọc được dữ liệu Drive: '+error.message);
  }
}
