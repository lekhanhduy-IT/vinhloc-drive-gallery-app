/* VinhLoc QL Anh deployment-version observer.
   Each new Vercel build invalidates only this app's login, never localforage.
   Active uploads finish before sign-out/reload. */
(() => {
  'use strict';
  if(window.__vlVersionManager)return;
  window.__vlVersionManager=true;
  const RELEASE='3.1.6';
  const BUILD_KEY='vinhloc_deployed_build_v1';
  const OLD_VERSION='2.9.8'; // old obfuscated script.js still checks this tag
  const knownLegacy=localStorage.getItem('vinhloc_app_version');
  // Prevent legacy change detection from clearing IndexedDB when script.js runs.
  try {localStorage.setItem('vinhloc_app_version',OLD_VERSION);}catch(_){}
  let current=null, busy=false, queued=null, applying=false, observedBuild=null;
  let shownVersion='', lastCheck=0, banner=null;
  function uploading() {
    return !!window.vlUploadGrid?.isActive?.() || !!window.vlActiveUploadIds?.size ||
      !!window.vlUploadQueueActive;
  }
  function short(id){return String(id||'').slice(0,8);}
  function showVersion(data){
    const label='Phiên bản '+data.version;
    if(label===shownVersion && document.getElementById('app-version-display')?.dataset.version===label)return;
    shownVersion=label;
    const subtitle=document.getElementById('version-subtitle');
    if(subtitle)subtitle.textContent=label;
    const menu=document.querySelector('#sidebar .flex-1');
    if(!menu)return;
    let tag=document.getElementById('app-version-display');
    if(!tag){
      tag=document.createElement('div');
      tag.id='app-version-display';
      tag.className='flex items-center gap-3 py-4 mt-2 pl-[24px] pr-[20px] text-[11px] text-red-400 tracking-widest opacity-80 cursor-default';
      menu.appendChild(tag);
    }
    if(tag.dataset.version!==label){
      tag.textContent='';
      const icon=document.createElement('i');icon.className='fas fa-code-branch w-6 text-center';
      const value=document.createElement('span');value.textContent=label;
      tag.append(icon,value);
      tag.dataset.version=label;
    }
  }
  function waiting() {
    if(!banner){
      banner=document.createElement('div');banner.setAttribute('role','status');
      banner.style.cssText='position:fixed;left:50%;top:calc(env(safe-area-inset-top, 0px) + 10px);transform:translateX(-50%);max-width:90vw;min-width:230px;padding:12px 16px;border-radius:12px;background:#0f172a;color:white;text-align:center;font:600 13px system-ui;z-index:999999998;box-shadow:0 6px 22px #0003;';
      document.body.appendChild(banner);
    }
    banner.textContent='Có bản cập nhật mới. Đang chờ upload hoàn tất để đăng nhập lại.';
  }
  async function apply(data){
    if(applying)return;
    if(uploading()){queued=data;waiting();return;}
    applying=true;queued=null;
    banner?.remove();banner=null;
    try {
      // Commit first, so reload does not trigger repeated sign-outs.
      localStorage.setItem(BUILD_KEY,data.build);
      if(localStorage.getItem('vinhloc_authenticated_email')){
        localStorage.removeItem('vinhloc_authenticated_email');
        localStorage.removeItem('vinhloc_spider_pwa_loaded');
        localStorage.removeItem('vinhloc_spider_browser_loaded');
        localStorage.removeItem('vinhloc_loaded_accounts');
        localStorage.removeItem('vinhloc_device_patched');
        try {window.google?.accounts?.id?.disableAutoSelect?.();}catch(_){}
        try {
          await Promise.race([
            fetch('/api/media',{method:'POST',credentials:'same-origin',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({action:'logout'}),cache:'no-store'}),
            new Promise(resolve=>setTimeout(resolve,2500))
          ]);
        }catch(error){console.warn('[QL Ảnh] Không thể đóng phiên media:',error);}
      }
      const url=new URL(location.href);
      url.searchParams.set('vl_build',short(data.build));
      location.replace(url.pathname+url.search+url.hash);
    }catch(error){applying=false;console.error('[QL Ảnh] Cập nhật chưa hoàn tất',error);}
  }
  function onBuild(data){
    const version=String(data.version||'');
    const build=String(data.build||'');
    if(!version||!build)return;
    const last=localStorage.getItem(BUILD_KEY);
    const firstMigration=last===null && knownLegacy && knownLegacy!==version &&
      !!localStorage.getItem('vinhloc_authenticated_email');
    observedBuild=build;
    current={version,build};
    showVersion(current);
    if(last===null&&!firstMigration){localStorage.setItem(BUILD_KEY,build);return;}
    if(firstMigration || (last!==null&&last!==build))void apply(current);
  }
  async function check(force=false){
    if(applying || busy || (!force && Date.now()-lastCheck<12000))return;
    busy=true;lastCheck=Date.now();
    try {
      const response=await fetch('/api/app-version?t='+Date.now(),{
        cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw Error('HTTP '+response.status);
      onBuild(await response.json());
    }catch(error){console.warn('[QL Ảnh] Chưa đọc được phiên bản mới',error);}
    finally{busy=false;}
  }
  function resume(){
    if(queued){void apply(queued);return;}
    void check(true);
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
  window.addEventListener('focus',()=>{if(!document.hidden)resume();});
  window.addEventListener('online',resume);
  window.addEventListener('storage',event=>{
    if(event.key===BUILD_KEY && event.newValue &&
      observedBuild && event.newValue!==observedBuild) {
      // Another tab updated this deployment; locally reload without losing
      // upload work or clearing app data.
      void apply({version:current?.version||RELEASE,build:event.newValue});
    }
  });
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>void check(true),{once:true});
  else void check(true);
  const sidebar=document.querySelector('#sidebar .flex-1');
  if(sidebar && window.MutationObserver){
    new MutationObserver(()=>{if(current)showVersion(current);})
      .observe(sidebar,{childList:true});
  }
  setInterval(()=>{
    if(queued)resume();
    else if(!document.hidden)void check();
  },12000);
})();