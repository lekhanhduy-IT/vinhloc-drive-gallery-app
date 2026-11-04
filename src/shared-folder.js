/* Signed folder-share session: external Google accounts can work only inside
   the shared subtree. Internal Shared Drive members keep mega-row/info UI.
   The visible UI guard is backed by /api/media and /api/owned-files checks. */
(() => {
  'use strict';
  const args=new URLSearchParams(location.search);
  const root=args.get('shareId');
  if(!root||args.get('shareType')!=='folder')return;
  const grant=args.get('shareGrant')||'';
  const name=args.get('shareName')||'Thư mục chia sẻ';
  const idPattern=/^[A-Za-z0-9_-]{10,180}$/;
  if(!idPattern.test(root))return;
  // Legacy share patch rewrites the URL without shareGrant. Preserve the
  // signed capability during every history replacement and PWA reload.
  if(grant){
    const baseReplace=history.replaceState.bind(history);
    history.replaceState=function(state,title,nextUrl){
      try{
        const target=new URL(nextUrl||location.href,location.href);
        if(target.origin===location.origin){
          target.searchParams.set('shareId',root);
          target.searchParams.set('shareType','folder');
          target.searchParams.set('shareName',name);
          target.searchParams.set('shareGrant',grant);
          return baseReplace(state,title,target.pathname+target.search+target.hash);
        }
      }catch(_){}
      return baseReplace(state,title,nextUrl);
    };
  }
  const endpoint='https://script.google.com/macros/s/';
  const authApi='/api/media';
  let ready=false,member=false,authBusy=false,installedLoad=null,installedShare=null,modal=null;
  const permitted=new Set([root]);
  window.vlShareScope={root,grant,name,allowed:id=>permitted.has(id),ready:()=>ready,member:()=>member};
  const nativeFetch=window.fetch.bind(window);
  function asResponse(json,status=200){
    return new Response(JSON.stringify(json),{status,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  // The original Apps Script endpoint has no per-share authorization context.
  // Never use that endpoint directly from a shared session: serve scoped
  // listings through a verified, same-origin API instead.
  window.fetch=async function(resource,options={}){
    const url=typeof resource==='string'?resource:resource?.url||'';
    if(!String(url).startsWith(endpoint))return nativeFetch(resource,options);
    let body={};
    try{body=JSON.parse(options?.body||'{}');}catch(_){}
    if(body.action==='getMeta')return asResponse({success:true,data:{},meta:{}});
    if(body.action!=='list')
      return asResponse({success:false,message:'Tác vụ ngoài phạm vi chia sẻ bị từ chối'},403);
    if(!grant||!ready)
      return asResponse({success:false,message:'Cần xác thực Google qua liên kết chia sẻ'},401);
    return nativeFetch('/api/shared-folder',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folderId:body.folderId}),cache:'no-store'
    });
  };
  function toast(message){
    if(typeof window.showToast==='function')window.showToast(message,true);
    else console.warn('[QL Ảnh chia sẻ]',message);
  }
  function resetStack(){
    const stack=window.folderStack;
    if(!Array.isArray(stack))return;
    const at=stack.findIndex(x=>x.id===root);
    if(at>0)stack.splice(0,at);
    if(at<0){
      stack.splice(0,stack.length,{id:root,name,scrollTop:0});
    }
    const allowedStack=[stack[0]];
    for(const item of stack.slice(1)){
      if(permitted.has(item.id))allowedStack.push(item);
      else break;
    }
    if(allowedStack.length!==stack.length)stack.splice(0,stack.length,...allowedStack);
    try{localStorage.setItem('appFolderStack',JSON.stringify(stack));}catch(_){}
    const back=document.getElementById('btnBack');
    if(back && stack.length<=1)back.style.display='none';
  }
  async function scoped(id){
    if(!ready||!grant||!idPattern.test(String(id||'')))return false;
    if(id===root || permitted.has(id))return true;
    try{
      const r=await nativeFetch('/api/owned-files',{
        method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({action:'scopeCheck',id}),cache:'no-store'
      });
      if(!r.ok)return false;
      const data=await r.json();
      if(data.success&&data.allowed){permitted.add(id);return true;}
    }catch(_){}
    return false;
  }
  function installNavigation(){
    const original=window.loadFolder;
    if(typeof original!=='function'||original.__vlShareBound)return;
    const guarded=async function(id,label,...rest){
      if(id==='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT'){
        id=root; label=name;
      }
      if(!await scoped(id)){
        toast('Chỉ được truy cập thư mục được chia sẻ và các thư mục con');
        resetStack();
        return;
      }
      resetStack();
      const result=await original.call(this,id,label,...rest);
      resetStack();
      return result;
    };
    guarded.__vlShareBound=true;
    installedLoad=guarded;
    window.loadFolder=guarded;
  }
  async function issueShare(id,type,label,event){
    event?.stopPropagation?.();
    if(type!=='folder')return false;
    if(!ready && grant){toast('Cần đăng nhập Google để chia sẻ');return true;}
    if(grant){toast('Không được chia sẻ tiếp ra ngoài phạm vi được chia sẻ');return true;}
    try{
      const res=await nativeFetch('/api/owned-files',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'issueShare',folderId:id}),cache:'no-store'
      });
      const out=await res.json();
      if(!res.ok||!out.success)throw Error(out.message||'Không tạo được liên kết');
      const link=new URL(location.origin+location.pathname);
      link.searchParams.set('shareId',id);
      link.searchParams.set('shareType','folder');
      link.searchParams.set('shareName',label||'Thư mục chia sẻ');
      link.searchParams.set('shareGrant',out.shareGrant);
      document.querySelectorAll('.item-action-menu').forEach(el=>el.classList.add('hidden'));
      if(navigator.share)await navigator.share({title:'Chia sẻ: '+label,url:link.href});
      else if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(link.href);
        if(typeof window.showToast==='function')window.showToast('Đã sao chép liên kết chia sẻ có giới hạn');
      }else window.prompt('Sao chép liên kết chia sẻ',link.href);
    }catch(error){if(error.name!=='AbortError')toast(error.message);}
    return true;
  }
  function installShare(){
    const base=window.shareItem;
    if(typeof base!=='function'||base.__vlShareBound)return;
    const wrapper=function(id,type,label,event){
      if(type==='folder')return issueShare(id,type,label,event);
      if(grant){toast('Chỉ được thao tác trong thư mục chia sẻ');return;}
      return base.apply(this,arguments);
    };
    wrapper.__vlShareBound=true;
    installedShare=wrapper;
    window.shareItem=wrapper;
  }
  function memberControls(){
    document.body.dataset.vlShareMember=member?'true':'false';
    if(member){
      // Remove only the legacy guest shield. Internal members retain
      // mega-row creation, folder information, and existing tools.
      for(const style of document.querySelectorAll('head style')){
        if(style.textContent.includes('#headerDropdownContainer,')&&
           style.textContent.includes('#spider-brain-loader,'))style.remove();
      }
      window.__IS_GUEST=false;
      const auth=document.getElementById('auth-overlay');
      if(auth){auth.classList.add('hidden');auth.style.display='none';}
    }else{
      window.__IS_GUEST=true;
      // The owner-only menu is safe: its operations use /api/owned-files.
      const style=document.getElementById('vl-share-owner-tools')||document.createElement('style');
      style.id='vl-share-owner-tools';
      style.textContent='body[data-vl-share-member="false"] #headerDropdownContainer{display:flex!important;}'+
       'body[data-vl-share-member="false"] #headerDropdown{max-height:65vh;overflow-y:auto;}'+
       'body[data-vl-share-member="false"] #btn-open-design,'+
       'body[data-vl-share-member="false"] #pasteDestBtn{display:none!important;}';
      document.head.appendChild(style);
    }
    // Shared-link navigation is always scoped; members can access the full
    // workspace separately by opening the ordinary app without shareId.
    const pageStyle=document.getElementById('vl-share-page-boundary')||document.createElement('style');
    pageStyle.id='vl-share-page-boundary';
    pageStyle.textContent='#btnMenu,#sidebar,#sidebar-overlay{display:none!important;}';
    document.head.appendChild(pageStyle);
    resetStack();
    const menu=window.vlOwnerAccess;
    void menu?.refresh?.();
    window.dispatchEvent(new CustomEvent('vl:share-member-ready'));
  }
  function closeModal(){modal?.remove();modal=null;}
  function authScreen(message){
    if(modal)return;
    modal=document.createElement('section');
    modal.id='vl-share-login-gate';
    modal.style.cssText='position:fixed;inset:0;z-index:999999999;background:#ffffff;color:#111111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:24px;text-align:center;font:600 16px system-ui;';
    const icon=document.createElement('img');
    icon.src='load_login.GIF';icon.alt='QL Ảnh';icon.style.cssText='width:80px;height:80px;object-fit:contain;';
    const title=document.createElement('h2');
    title.textContent='TRUY CẬP THƯ MỤC ĐƯỢC CHIA SẺ';
    title.style.cssText='font-weight:800;font-size:18px;max-width:320px;';
    const caption=document.createElement('p');
    caption.textContent=message||'Đăng nhập Google để xem và quản lý các mục do bạn tải lên trong thư mục này.';
    caption.style.cssText='font-size:14px;max-width:360px;line-height:1.5;';
    const slot=document.createElement('div');slot.id='vlSharedGoogleSignin';
    slot.style.cssText='position:relative;width:260px;height:48px;display:flex;align-items:center;justify-content:center;';
    const help=document.createElement('p');
    help.textContent='Nhấn Đăng nhập để chọn tài khoản Google. Nếu không hiện cửa sổ chọn tài khoản, hãy mở liên kết bằng Safari hoặc Chrome (không dùng trình duyệt bên trong ứng dụng nhắn tin).';
    help.style.cssText='font-size:12px;line-height:1.5;max-width:340px;color:#111111;';
    const copy=document.createElement('button');
    copy.type='button';
    copy.textContent='Sao chép liên kết để mở bằng Safari';
    copy.style.cssText='font:600 13px system-ui;border:0.5px solid #9ca3af;border-radius:999px;padding:10px 16px;background:transparent;color:#111111;cursor:pointer;min-height:44px;';
    copy.addEventListener('click',async()=>{
      try {
        if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(location.href);
        copy.textContent='Đã sao chép liên kết';
      }catch(_) {
        window.prompt('Sao chép liên kết rồi mở bằng Safari hoặc Chrome',location.href);
      }
    });
    const warning=document.createElement('p');warning.id='vlShareAuthMessage';
    warning.style.cssText='font-size:13px;max-width:350px;min-height:1.5em;color:#111111;';
    modal.append(icon,title,caption,slot,help,copy,warning);
    document.body.appendChild(modal);
    if(!grant){warning.textContent='Liên kết chia sẻ cũ chưa có mã xác minh. Vui lòng yêu cầu chủ thư mục tạo liên kết mới.';return;}
    let attempts=0;
    const timer=setInterval(()=>{
      const sdk=window.google?.accounts?.id;
      if(!sdk?.initialize || !sdk?.renderButton){
        if(++attempts>80){clearInterval(timer);warning.textContent='Không thể tải đăng nhập Google';}
        return;
      }
      clearInterval(timer);
      sdk.initialize({client_id:'1034177686409-1fhm0m0tqmf58qjj1p0r2ifo018eh8o2.apps.googleusercontent.com',
        callback:async output=>{
          if(authBusy||!output?.credential)return;
          authBusy=true;warning.textContent='Đang xác thực quyền truy cập…';
          try{
            const r=await nativeFetch(authApi,{
              method:'POST',credentials:'same-origin',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({credential:output.credential,shareGrant:grant})
            });
            const data=await r.json();
            if(!r.ok||!data.success||data.scopeRoot!==root)throw Error(data.message||'Từ chối quyền truy cập');
            ready=true;member=data.isMember===true;
            closeModal();memberControls();
            void window.vlMediaEnsureAuth?.();
            // Discard stale global caches from a previous account/device.
            try{if(typeof folderDataCache!=='undefined')delete folderDataCache[root];}catch(_){}
            if(typeof window.loadFolder==='function')await window.loadFolder(root,name,false,false);
          }catch(error){warning.textContent=error.message;}
          finally{authBusy=false;}
        },
        auto_select:false,
        button_auto_select:false,
        use_fedcm_for_button:false
      });
      sdk.renderButton(slot,{type:'standard',theme:'outline',size:'large',
        shape:'pill',text:'signin',width:260,locale:'vi'});
    },150);
  }
  async function checkLogin(){
    if(!grant){authScreen();return;}
    try{
      const r=await nativeFetch('/api/media?status=1',{credentials:'same-origin',cache:'no-store'});
      if(r.ok){
        const x=await r.json();
        if(x.success && x.scopeRoot===root){
          ready=true;member=x.isMember===true;memberControls();
          void window.vlMediaEnsureAuth?.();
          if(typeof window.loadFolder==='function')
            void window.loadFolder(root,name,false,false);
          return;
        }
      }
    }catch(_){}
    authScreen();
  }
  function install(){
    installNavigation();
    installShare();
    if(ready)resetStack();
  }
  document.addEventListener('click',e=>{
    if(!ready)return;
    if(e.target.closest?.('#btnBack') && window.folderStack?.length<=1){
      e.preventDefault();e.stopImmediatePropagation();resetStack();
      return;
    }
    // Inline handlers may call the lexical loadFolder instead of the wrapper.
    const target=e.target.closest?.('#currentFolderName [onclick],.subfolder-row[onclick]');
    if(!target)return;
    const inline=target.getAttribute('onclick')||'';
    const match=inline.match(/loadFolder\s*\(\s*['"]([A-Za-z0-9_-]{10,180})['"]/);
    if(!match||permitted.has(match[1]))return;
    e.preventDefault();e.stopImmediatePropagation();
    void scoped(match[1]).then(ok=>{
      if(!ok){toast('Không được mở thư mục ngoài phạm vi chia sẻ');resetStack();return;}
      void window.loadFolder?.(match[1],target.textContent?.trim()||'Thư mục',true,false);
    });
  },true);
  window.addEventListener('popstate',()=>setTimeout(()=>{
    if(ready){
      resetStack();
      if(window.currentFolderId && !permitted.has(window.currentFolderId))
        void window.loadFolder?.(root,name,false,false);
    }
  },0));
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>{install();void checkLogin();},{once:true});
  else {install();void checkLogin();}
  setInterval(install,550);
})();