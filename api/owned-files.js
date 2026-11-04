import { verifiedAccount, serverDriveToken } from './media.js';
import {signFolderGrant,readFolderGrant} from '../lib/share-capability.js';

const SHARED_DRIVE_ID='0AMLRHzF05fTFUk9PVA';
const ROOT_FOLDER_ID='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
const META_SCRIPT_URL='https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';
async function saveMegaRowMeta(id,name,category){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),16000);
  try{
    const res=await fetch(META_SCRIPT_URL,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'updateSingleMeta',meta:{
        id,name,type:category,desc:'',cover:''
      }}),signal:abort.signal
    });
    if(!res.ok)throw Error('Apps Script HTTP '+res.status);
    const data=await res.json();
    if(data?.success!==true)throw Error(data?.message||data?.error||'Không lưu được metadata mega-row');
    return true;
  }finally{clearTimeout(timer);}
}

const ADMIN_EMAIL='admin@tudonghoavinhloc.com';
const LIMIT=50;
const idPattern=/^[A-Za-z0-9_-]{10,180}$/;
const api='https://www.googleapis.com/drive/v3/files';
const uploaderKey='vlUploadedBy';
const uploadKeyField='vlUploadKey';
const uploadKeyPattern=/^[A-Za-z0-9_-]{16,120}$/;
export const config={maxDuration:60};
function respond(res,status,message,extra={}) {
  res.setHeader('Cache-Control','no-store, private');
  return res.status(status).json({success:status<400,message,...extra});
}
async function drive(url,init={},retry=true){
  const token=await serverDriveToken();
  const response=await fetch(url,{...init,headers:{
    Authorization:'Bearer '+token,...(init.headers||{})
  }});
  if(response.status===401 && retry) return drive(url,init,false);
  return response;
}
async function jsonDrive(url,init){
  const r=await drive(url,init);
  let data={};
  try{data=await r.json();}catch(_){}
  if(!r.ok)throw new Error('Google Drive HTTP '+r.status+': '+String(data.error?.message||'Không có quyền').slice(0,140));
  return data;
}
async function fileInfo(id,fields='id,name,mimeType,driveId,trashed,appProperties,parents'){
  if(!idPattern.test(id))throw new Error('ID không hợp lệ');
  return jsonDrive(api+'/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields='+encodeURIComponent(fields));
}
function inGallery(file){
  return file && file.driveId===SHARED_DRIVE_ID && file.trashed!==true;
}
function own(file,email){
  return String(file.appProperties?.[uploaderKey]||'').toLowerCase()===email;
}
async function folder(id){
  const data=await fileInfo(id);
  if(!inGallery(data)||data.mimeType!=='application/vnd.google-apps.folder')
    throw new Error('Thư mục không thuộc kho ảnh được cấp quyền');
  return data;
}
async function inShareTree(id,root){
  if(!root)return true;
  if(id===root)return true;
  if(typeof id!=='string'||!idPattern.test(id))return false;
  const visited=new Set();
  let cursor=id;
  for(let depth=0;depth<45;depth++){
    if(visited.has(cursor))return false;
    visited.add(cursor);
    const f=await fileInfo(cursor,'id,driveId,trashed,parents');
    if(!inGallery(f))return false;
    const parents=f.parents||[];
    if(parents.includes(root))return true;
    if(parents.length!==1)return false;
    cursor=parents[0];
  }
  return false;
}
async function withinConfiguredRoot(id){
  const seen=new Set();
  let cursor=id;
  for(let depth=0;depth<45;depth++){
    if(cursor===ROOT_FOLDER_ID)return true;
    if(seen.has(cursor))return false;
    seen.add(cursor);
    const f=await fileInfo(cursor,'id,parents,trashed');
    if(f.trashed||(f.parents||[]).length!==1)return false;
    cursor=f.parents[0];
  }
  return false;
}
async function requireScope(id,root){
  if(root&&!await inShareTree(id,root))
    throw Object.assign(new Error('Không được thao tác ngoài phạm vi thư mục chia sẻ'),{status:403});
}
function fileType(file) {
  return file.mimeType==='application/vnd.google-apps.folder'?'folder':'file';
}
async function checkMany(ids,email,admin,root){
  const result={};
  const valid=[...new Set(ids)].filter(x=>typeof x==='string'&&idPattern.test(x)).slice(0,100);
  let next=0;
  await Promise.all(Array.from({length:Math.min(6,valid.length)},async()=>{
    while(next<valid.length){
      const id=valid[next++];
      try {
        const info=await fileInfo(id);
        const uploader=String(info.appProperties?.[uploaderKey]||'').trim().toLowerCase();
        const active=inGallery(info);
        result[id]={allowed:!!(active&&(admin||uploader===email)&&await inShareTree(id,root)),
          // Drive appProperties survive browser logout and device switches.
          // Files created before provenance tracking are not automatically
          // claimed by whoever happens to be logged in.
          provenance:active?(uploader?'drive-app-properties':'missing'):'unavailable',
          uploaderEmail:active?uploader||null:null,
          name:active?info.name:null,type:active?fileType(info):null};
      }catch(error){result[id]={allowed:false,error:'Không kiểm tra được quyền'};}
    }
  }));
  return result;
}
export default async function handler(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store, private');
  if(!['POST','GET'].includes(req.method))return respond(res,405,'Method not allowed');
  const origin=req.headers.origin;
  if(origin){
    try{if(new URL(origin).host!==req.headers.host)return respond(res,403,'Sai nguồn yêu cầu');}
    catch(_){return respond(res,403,'Nguồn yêu cầu không hợp lệ');}
  }
  let user;
  try{user=await verifiedAccount(req);}
  catch(_){return respond(res,401,'Cần xác thực Google trong QL Ảnh');}
  const email=user.email.toLowerCase();
  const admin=email===ADMIN_EMAIL;
  const scopeRoot=user.scopeRoot||null;
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  const action=body.action||req.query.action||'status';
  try{
    if(action==='status')return respond(res,200,'OK',{email,admin,scopeRoot,isMember:user.member===true||!scopeRoot});
    if(action==='issueShare'){
      if(scopeRoot)return respond(res,403,'Tài khoản chỉ có quyền trong thư mục được chia sẻ');
      const id=String(body.folderId||'');
      if(!idPattern.test(id))return respond(res,400,'ID thư mục không hợp lệ');
      await folder(id);
      return respond(res,200,'Liên kết chia sẻ',{shareGrant:await signFolderGrant(id,await serverDriveToken()),root:id});
    }
    if(action==='scopeCheck'){
      const id=String(body.id||'');
      if(!idPattern.test(id))return respond(res,400,'ID thư mục không hợp lệ');
      if(!await inShareTree(id,scopeRoot))return respond(res,403,'Đã vượt ra ngoài thư mục được chia sẻ');
      const info=await folder(id);
      return respond(res,200,'Trong phạm vi thư mục',{allowed:!!info.id,root:scopeRoot});
    }
    if(action==='check'){
      if(!Array.isArray(body.ids))return respond(res,400,'Thiếu danh sách ID');
      if(body.ids.length>100)return respond(res,400,'Tối đa 100 mục mỗi lượt');
      return respond(res,200,'OK',{items:await checkMany(body.ids,email,admin,scopeRoot)});
    }
    if(action==='createFolder'){
      const parentId=body.folderId;
      if(typeof parentId!=='string'||!idPattern.test(parentId))return respond(res,400,'ID thư mục cha không hợp lệ');
      await folder(parentId);
      await requireScope(parentId,scopeRoot);
      const isMegaRow=parentId===ROOT_FOLDER_ID;
      // A shared-folder grant never authorizes writing to the workspace root.
      if(isMegaRow&&(scopeRoot || user.member!==true))
        return respond(res,403,'Chỉ thành viên nội bộ được tạo mega-row tại thư mục gốc');
      const name=String(body.name||'').trim();
      if(!name||name.length>180)return respond(res,400,'Tên thư mục không hợp lệ');
      const payload={name,mimeType:'application/vnd.google-apps.folder',parents:[parentId],
        appProperties:{[uploaderKey]:email},
        description:body.category==='Ý tưởng'?'[Ý tưởng]':'[Triển khai]'};
      const created=await jsonDrive(api+'?supportsAllDrives=true&fields=id,name,mimeType,appProperties', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      let megaMetaSaved=!isMegaRow;
      let metaError='';
      if(isMegaRow){
        try {
          megaMetaSaved=await saveMegaRowMeta(created.id,name,
            body.category==='Ý tưởng'?'Ý tưởng':'Triển khai');
        }catch(error){
          metaError='Đã tạo thư mục trên Drive nhưng chưa ghi được thông tin mega-row vào Sheets';
          console.warn('[QL Ảnh] Mega-row metadata',created.id,error);
        }
      }
      return respond(res,200,'Đã tạo thư mục',{
        id:created.id,name:created.name,uploaderEmail:email,
        isMegaRow,megaMetaSaved,...(metaError?{warning:metaError}:{})
      });
    }
    if(action==='startUpload'){
      const parentId=body.folderId;
      if(typeof parentId!=='string'||!idPattern.test(parentId))return respond(res,400,'ID thư mục cha không hợp lệ');
      await folder(parentId);
      const name=String(body.name||'').trim().slice(0,250);
      const mime=String(body.mimeType||'application/octet-stream');
      const size=Number(body.size);
      if(!name || !Number.isSafeInteger(size) || size<=0 || size>5*1024*1024*1024)
        return respond(res,400,'Tên file hoặc kích thước không hợp lệ');
      if(!/^(image|video)\//.test(mime))return respond(res,415,'Chỉ nhận ảnh và video');
      const uploadKey=String(body.uploadKey||'');
      if(!uploadKeyPattern.test(uploadKey))return respond(res,400,'Thiếu mã upload duy nhất');
      const session=await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,appProperties',{
        method:'POST',
        headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(size)},
        body:JSON.stringify({name,mimeType:mime,parents:[parentId],appProperties:{[uploaderKey]:email,[uploadKeyField]:uploadKey}})
      });
      if(!session.ok)return respond(res,502,'Không tạo được phiên upload lên Drive ('+session.status+')');
      const uploadUrl=session.headers.get('location');
      if(!uploadUrl||!uploadUrl.startsWith('https://www.googleapis.com/'))
        return respond(res,502,'Drive không trả địa chỉ upload hợp lệ');
      return respond(res,200,'Đã tạo phiên upload',{uploadUrl});
    }
    if(action==='inspectUpload'){
      const id=String(body.id||'');
      const folderId=String(body.folderId||'');
      const key=String(body.uploadKey||'');
      if(!idPattern.test(id)||!idPattern.test(folderId)||!uploadKeyPattern.test(key))
        return respond(res,400,'Mã xác minh file upload không hợp lệ');
      // A valid upload must be present in the app's Shared Drive and the
      // destination folder. A bare successful resumable PUT is insufficient.
      const parent=await fileInfo(folderId);
      const internalRoot=admin&&!scopeRoot&&await withinConfiguredRoot(folderId);
      if((!inGallery(parent)&&!internalRoot)||
         parent.mimeType!=='application/vnd.google-apps.folder')
        return respond(res,403,'Thư mục không thuộc kho ảnh được cấp quyền');
      await requireScope(folderId,scopeRoot);
      const info=await fileInfo(id);
      if((!inGallery(info)&&!internalRoot)||
         info.trashed || !(info.parents||[]).includes(folderId)||
         info.appProperties?.[uploadKeyField]!==key ||
         (!admin&&!own(info,email)))
        return respond(res,409,'Drive chưa xác minh file nằm đúng thư mục hoặc quyền người tải lên');
      return respond(res,200,'Đã xác minh vị trí và quyền upload',{
        file:{id:info.id,name:info.name,mimeType:info.mimeType,driveId:info.driveId}
      });
    }
    if(action==='confirmUpload'){
      const parentId=body.folderId;
      const uploadKey=String(body.uploadKey||'');
      if(typeof parentId!=='string'||!idPattern.test(parentId)||
         !uploadKeyPattern.test(uploadKey))
        return respond(res,400,'Mã đối chiếu upload không hợp lệ');
      await folder(parentId);
      const escaped=uploadKey.replace(/'/g,"\\'");
      const q=new URLSearchParams({
        q:"'"+parentId+"' in parents and trashed=false and appProperties has { key='"+uploadKeyField+"' and value='"+escaped+"' }",
        fields:'nextPageToken,files(id,name,mimeType,size,createdTime,appProperties,driveId,trashed)',
        pageSize:'50',supportsAllDrives:'true',includeItemsFromAllDrives:'true'
      });
      const listed=await jsonDrive(api+'?'+q);
      const matching=(listed.files||[]).filter(x=>inGallery(x)&&(admin||own(x,email))&&
        x.appProperties?.[uploadKeyField]===uploadKey);
      if(matching.length>1)return respond(res,409,'Mã upload bị trùng, cần kiểm tra thủ công');
      const file=matching[0]||null;
      return respond(res,200,file?'Drive đã nhận file':'Drive chưa xác nhận file',{
        found:!!file,file:file?{
          id:file.id,name:file.name,mimeType:file.mimeType,
          size:Number(file.size||0),createdTime:file.createdTime,
          uploaderEmail:file.appProperties?.[uploaderKey]||null
        }:null
      });
    }
    if(action==='rename'){
      const id=body.id;
      if(typeof id!=='string'||!idPattern.test(id))return respond(res,400,'ID không hợp lệ');
      const name=String(body.name||'').trim();
      if(!name||name.length>250||/[\/\u0000-\u001f]/.test(name))
        return respond(res,400,'Tên mục không hợp lệ');
      const info=await fileInfo(id);
      if(!inGallery(info))return respond(res,404,'Không tìm thấy mục trong kho ảnh');
      await requireScope(id,scopeRoot);
      if(scopeRoot&&id===scopeRoot)return respond(res,403,'Không thể đổi tên thư mục gốc được chia sẻ');
      if(!admin&&!own(info,email))return respond(res,403,'Chỉ được sửa tên mục do mình tạo');
      const update=await jsonDrive(api+'/'+encodeURIComponent(id)+
        '?supportsAllDrives=true&fields=id,name,appProperties',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name})
      });
      return respond(res,200,'Đã đổi tên',{id:update.id,name:update.name});
    }
    if(action==='delete'){
      const id=body.id;
      if(typeof id!=='string'||!idPattern.test(id))return respond(res,400,'ID không hợp lệ');
      const info=await fileInfo(id);
      if(!inGallery(info))return respond(res,404,'Không tìm thấy tệp trong kho ảnh');
      await requireScope(id,scopeRoot);
      if(scopeRoot&&id===scopeRoot)return respond(res,403,'Không thể xóa thư mục gốc được chia sẻ');
      if(!admin&&!own(info,email))return respond(res,403,'Bạn chỉ được xóa mục do chính tài khoản mình tải lên');
      // Deleting a folder also trashes its descendants. Non-admin must
      // not be able to delete a folder containing someone else's files.
      if(!admin && fileType(info)==='folder'){
        // Recursively verify the whole subtree; no implied ownership through
        // parent folder. Fail closed on unknown owner, nested folders or
        // excessively large listings.
        const pending=[id];
        const visited=new Set();
        let count=0;
        while(pending.length){
          const parent=pending.shift();
          if(visited.has(parent))continue;
          visited.add(parent);
          if(visited.size>2000)return respond(res,409,'Thư mục quá lớn, cần quản trị viên xóa');
          const q=new URLSearchParams({q:"'"+parent+"' in parents and trashed=false",
            fields:'nextPageToken,files(id,name,appProperties,mimeType)',pageSize:'1000',
            supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
          let page='';
          do {
            if(page)q.set('pageToken',page);else q.delete('pageToken');
            const listing=await jsonDrive(api+'?'+q);
            for(const child of listing.files||[]){
              count++;
              if(count>2000)return respond(res,409,'Thư mục quá lớn, cần quản trị viên xóa');
              if(!own(child,email))
                return respond(res,403,'Thư mục có nội dung do tài khoản khác tải lên');
              if(fileType(child)==='folder')pending.push(child.id);
            }
            page=listing.nextPageToken||'';
          } while(page);
        }
      }
      const update=await drive(api+'/'+encodeURIComponent(id)+'?supportsAllDrives=true',{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})
      });
      if(!update.ok)return respond(res,502,'Drive từ chối xóa ('+update.status+')');
      return respond(res,200,'Đã chuyển mục vào thùng rác',{id});
    }
    return respond(res,400,'Tác vụ không hỗ trợ');
  }catch(e){return respond(res,e.status===403?403:502,'Không thực hiện được: '+e.message);}
}