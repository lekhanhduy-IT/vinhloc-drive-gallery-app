/* QL Ảnh – Google Identity Services native buttons.
   DO NOT replace or paint over Google's iframe. Google's supported
   text:"signin" produces the localized "Đăng nhập" label.
   A scoped share login must not have its credential callback overwritten
   by the legacy full-workspace login on the same page. */
(() => {
  'use strict';
  if(window.__vlNativeGoogleSigninV314)return;
  window.__vlNativeGoogleSigninV314=true;

  const params=new URLSearchParams(window.location.search);
  const isShare=!!(params.get('shareId')&&params.get('shareType')==='folder');
  const targets=new Set(['google-login-btn','vlSharedGoogleSignin']);
  const options=element=>{
    const max=260;
    const w=Math.min(max,Math.max(180,(window.innerWidth||390)-90));
    return {type:'standard',theme:'outline',size:'large',shape:'pill',
      text:'signin',width:w,logo_alignment:'left',locale:'vi'};
  };
  let patchedService=null;
  const installed=new WeakSet();

  function install(){
    const sdk=window.google?.accounts?.id;
    if(!sdk?.renderButton || !sdk?.initialize)return false;
    if(sdk===patchedService)return true;
    if(sdk.renderButton.__vlNativeGoogleSigninV314){
      patchedService=sdk;
      return true;
    }
    const render=sdk.renderButton.bind(sdk);
    const initialize=sdk.initialize.bind(sdk);

    sdk.initialize=function(config){
      // The legacy full-app script also calls initialize() on share links,
      // which otherwise replaces the link-specific credential callback.
      if(isShare&&config?.callback &&
         typeof window.handleCredentialResponse==='function' &&
         config.callback===window.handleCredentialResponse){
        return;
      }
      return initialize({...config,auto_select:false,button_auto_select:false,use_fedcm_for_button:false});
    };

    function renderNative(target,requested){
      const element=typeof target==='string'?document.querySelector(target):target;
      if(!element || !targets.has(element.id))
        return render(target,requested);

      if(isShare && element.id==='google-login-btn'){
        // The full-app sign-in is not a valid entry point for external
        // shared-link users. Only the verified shared login can run here.
        element.replaceChildren();
        return;
      }
      // The SDK owns the complete clickable surface (including text).
      // A third-party overlay must never enlarge or cover this iframe.
      element.querySelectorAll('.vl-google-readable-label').forEach(e=>e.remove());
      if(installed.has(element))return;
      installed.add(element);
      element.replaceChildren();
      element.classList.add('vl-native-google-signin');
      const style=element.style;
      style.width='min(260px, calc(100vw - 90px))';
      style.maxWidth='100%';
      style.minHeight='44px';
      style.height='auto';
      style.position='relative';
      style.overflow='visible';
      const result=render(element,{...requested,...options(element)});
      // Failed or delayed SDK rendering can be retried by the owner code.
      if(!element.querySelector('iframe')){
        setTimeout(()=>{
          if(!element.isConnected)return;
          if(!element.querySelector('iframe'))installed.delete(element);
        },1200);
      }
      return result;
    }
    renderNative.__vlNativeGoogleSigninV314=true;
    sdk.renderButton=renderNative;
    patchedService=sdk;
    return true;
  }
  install();
  const poll=setInterval(()=>{if(install())clearInterval(poll);},80);
  // Drop stale visual overlays after an iOS PWA page restoration.
  document.addEventListener('pageshow',()=>{
    for(const id of targets)
      document.getElementById(id)?.querySelectorAll('.vl-google-readable-label')
        .forEach(x=>x.remove());
  });
})();