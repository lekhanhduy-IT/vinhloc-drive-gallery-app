import { verifiedAccount, serverDriveToken } from './media.js';

const SHARED_DRIVE_ID='0AMLRHzF05fTFUk9PVA';
const ADMIN_EMAIL='admin@tudonghoavinhloc.com';
const LIMIT=50;
const idPattern=/^[A-Za-z0-9_-]{10,180}$/;
const api='https://www.googleapis.com/drive/v3/files';
const uploaderKey='vlUploadedBy';
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
function fileType(file) {
  return file.mimeType==='application/vnd.google-apps.folder'?'folder':'file';
}
async function checkMany(ids,email,admin){
  const result={};
  const valid=[...new Set(ids)].filter(x=>typeof x==='string'&&idPattern.test(x)).slice(0,100);
  let next=0;
  await Promise.all(Array.from({length:Math.min(6,valid.length)},async()=>{
    while(next<valid.length){
      const id=valid[next++];
      try {
        const info=await fileInfo(id);
        result[id]={allowed:!!(inGallery(info)&&(admin||own(info,email))),
          uploaderEmail:inGallery(info)?info.appProperties?.[uploaderKey]||null:null,
          name:inGallery(info)?info.name:null,type:inGallery(info)?fileType(info):null};
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
  let body=req.body||{};
  if(typeof body==='string')try{body=JSON.parse(body);}catch(_){body={};}
  const action=body.action||req.query.action||'status';
  try{
    if(action==='status')return respond(res,200,'OK',{email,admin});
    if(action==='check'){
      if(!Array.isArray(body.ids))return respond(res,400,'Thiếu danh sách ID');
      if(body.ids.length>100)return respond(res,400,'Tối đa 100 mục mỗi lượt');
      return respond(res,200,'OK',{items:await checkMany(body.ids,email,admin)});
    }
    if(action==='createFolder'){
      const parentId=body.folderId;
      if(typeof parentId!=='string'||!idPattern.test(parentId))return respond(res,400,'ID thư mục cha không hợp lệ');
      await folder(parentId);
      const name=String(body.name||'').trim();
      if(!name||name.length>180)return respond(res,400,'Tên thư mục không hợp lệ');
      const payload={name,mimeType:'application/vnd.google-apps.folder',parents:[parentId],
        appProperties:{[uploaderKey]:email},
        description:body.category==='Ý tưởng'?'[Ý tưởng]':'[Triển khai]'};
      const created=await jsonDrive(api+'?supportsAllDrives=true&fields=id,name,mimeType,appProperties', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      return respond(res,200,'Đã tạo thư mục',{id:created.id,name:created.name,uploaderEmail:email});
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
      const session=await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,appProperties',{
        method:'POST',
        headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(size)},
        body:JSON.stringify({name,mimeType:mime,parents:[parentId],appProperties:{[uploaderKey]:email}})
      });
      if(!session.ok)return respond(res,502,'Không tạo được phiên upload lên Drive ('+session.status+')');
      const uploadUrl=session.headers.get('location');
      if(!uploadUrl||!uploadUrl.startsWith('https://www.googleapis.com/'))
        return respond(res,502,'Drive không trả địa chỉ upload hợp lệ');
      return respond(res,200,'Đã tạo phiên upload',{uploadUrl});
    }
    if(action==='delete'){
      const id=body.id;
      if(typeof id!=='string'||!idPattern.test(id))return respond(res,400,'ID không hợp lệ');
      const info=await fileInfo(id);
      if(!inGallery(info))return respond(res,404,'Không tìm thấy tệp trong kho ảnh');
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
  }catch(e){return respond(res,502,'Không thực hiện được: '+e.message);}
}