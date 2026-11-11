/* Native upload does not depend on WebView JavaScript remaining active.
   Keep the existing resumable fetch uploader for ordinary browser/PWA sessions. */
import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin('VLBackgroundUpload');
const enabled = Capacitor.isNativePlatform();
const sameOrigin = location.protocol === 'https:' && location.hostname !== 'localhost';
const selectedOrigin = import.meta.env.VITE_VL_UPLOAD_API_ORIGIN || (sameOrigin ? location.origin : '');
const apiOrigin = selectedOrigin.endsWith('/') ? selectedOrigin.slice(0,-1) : selectedOrigin;
let lastCompleted = new Set();
const verifying = new Set();
function inform(message,bad=false) {
  if (typeof window.showToast === 'function') window.showToast(message,bad);
  else console[bad?'warn':'info']('[Upload nền]',message);
}
function uploadFolder(){
  try{return typeof currentFolderId !== 'undefined'?currentFolderId:window.currentFolderId;}
  catch(_){return window.currentFolderId||'';}
}
function display(jobs){
  const ongoing = jobs.filter(x=>['queued','staging','preparing','uploading','retrying','probing','uploaded'].includes(x.status));
  const paused = jobs.filter(x=>['paused','auth_required'].includes(x.status));
  let indicator=document.getElementById('vlNativeUploadStatus');
  if(!indicator) {
    indicator=document.createElement('div');
    indicator.id='vlNativeUploadStatus';
    indicator.style.cssText='position:fixed;bottom:calc(12px + env(safe-area-inset-bottom));left:12px;z-index:30;padding:9px 13px;border-radius:11px;background:#fff;color:#334155;border:1px solid #cbd5e1;box-shadow:0 4px 12px #0002;font:600 12px system-ui;max-width:calc(100vw - 24px);pointer-events:none';
    document.body.appendChild(indicator);
  }
  indicator.hidden=!(ongoing.length||paused.length);
  if(ongoing.length)indicator.textContent='Upload nền · '+ongoing.length+' file đang xử lý'+(paused.length?' · '+paused.length+' tạm dừng':'');
  else if(paused.length)indicator.textContent='Upload tạm dừng · '+paused.length+' file (mở app để thử lại)';
  for(const job of jobs){
    if(job.status!=='complete'||lastCompleted.has(job.id))continue;
    lastCompleted.add(job.id);
    // The folder must be re-fetched from Drive; do not invent or cache a file ID.
    window.vlSharedPreload?.refreshFolder?.(job.folderId);
  }
}
async function verifyUploaded(job){
  if(verifying.has(job.id)||!apiOrigin)return;
  verifying.add(job.id);
  try{
    const response=await fetch(apiOrigin+'/api/owned-files',{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'confirmUpload',folderId:job.folderId,uploadKey:job.uploadKey})
    });
    const result=await response.json();
    if(response.ok&&result.success&&result.found&&result.file?.id&&
      result.file.uploaderEmail?.toLowerCase()===job.owner?.toLowerCase()){
      await native.acknowledge({id:job.id,fileId:result.file.id});
      window.vlSharedPreload?.refreshFolder?.(job.folderId);
      lastCompleted.add(job.id);
      void sync(false);
    }
  }catch(error){console.warn('[Upload nền] Chưa xác minh file',error);}
  finally{verifying.delete(job.id);}
}
async function sync(resume=false){
  if(!enabled)return;
  try{
    const result=await native.getJobs({resume});
    display(result.jobs||[]);
    for(const job of result.jobs||[])if(job.status==='uploaded')void verifyUploaded(job);
  }catch(error){console.warn('[Upload nền] Không lấy được tiến độ',error);}
}
// Capture at window phase BEFORE legacy document-level label handling.
if(enabled){
  window.addEventListener('click',async event=>{
    const label=event.target.closest?.('label');
    if(!label)return;
    const image=label.querySelector('#uploadImage');
    const video=label.querySelector('#uploadVideo');
    if(!image&&!video)return;
    // An offline Capacitor app has no signed-in HTTPS API origin yet.
    // Leave the existing JS picker working instead of blocking uploads.
    if(!apiOrigin||!sameOrigin||apiOrigin!==location.origin)return;
    event.preventDefault();event.stopImmediatePropagation();
    const folderId=uploadFolder();
    if(!/^[A-Za-z0-9_-]{10,180}$/.test(String(folderId||''))){
      inform('Hãy mở thư mục Drive hợp lệ trước khi upload.',true);return;
    }
    try{
      // Freeze uploader identity BEFORE showing the native file picker.
      const response=await fetch(apiOrigin+'/api/owned-files',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'status'})
      });
      const status=await response.json();
      if(!response.ok||!status.success||!status.email)throw Error('Cần đăng nhập Google trên máy chủ trước khi upload.');
      const result=await native.pickAndUpload({origin:apiOrigin,owner:status.email,folderId,
        accept:image?'image':'video'});
      const count=(result.jobs||[]).length;
      if(count)inform('Đã giao '+count+' file cho tác vụ upload nền của hệ điều hành.');
      void sync(false);
    }catch(error){inform('Không thể bắt đầu upload nền: '+(error.message||error),true);}
  },true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync(true);});
  window.addEventListener('focus',()=>void sync(true));
  void sync(true);
  setInterval(()=>{if(!document.hidden)void sync(false);},5000);
}
