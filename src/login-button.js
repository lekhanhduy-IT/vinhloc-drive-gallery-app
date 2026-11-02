/* Enlarge only the initial Google login button, retaining GIS auth flow.
   The verification banner has its own "Cho phép" action. */
(() => {
  'use strict';
  if(window.__vlGoogleLargeButtonInstalled)return;
  window.__vlGoogleLargeButtonInstalled=true;
  const targetId='google-login-btn';
  let wrapped=null, original=null;
  const width=()=>Math.max(210,Math.min(288,(window.innerWidth||390)-96));
  function config(options){
    return {...options,type:'standard',size:'large',shape:'rectangular',
      theme:'outline',text:'signin_with',logo_alignment:'left',
      width:width(),locale:'vi'};
  }
  function install(){
    const sdk=window.google?.accounts?.id;
    if(typeof sdk?.renderButton!=='function')return false;
    const fn=sdk.renderButton;
    if(fn===wrapped)return true;
    if(fn.__vlLargeButtonPatched){wrapped=fn;return true;}
    original=fn;
    function patched(element,options){
      const node=typeof element==='string'?document.querySelector(element):element;
      if(node?.id===targetId) {
        node.classList.add('vl-google-login-wide');
        node.dataset.vlWide='1';
        return fn.call(this,node,config(options));
      }
      return fn.call(this,element,options);
    }
    patched.__vlLargeButtonPatched=true;
    try{sdk.renderButton=patched;wrapped=patched;return true;}
    catch(error){console.warn('[QL Ảnh] Google SDK chưa sẵn sàng',error);return false;}
  }
  function upgrade(){
    const button=document.getElementById(targetId);
    if(!button||button.dataset.vlWide==='1'||!button.querySelector('iframe')||!original)return;
    button.classList.add('vl-google-login-wide');
    try {
      button.replaceChildren();
      original.call(window.google.accounts.id,button,config({}));
      button.dataset.vlWide='1';
    }catch(error){console.warn('[QL Ảnh] Nút đăng nhập Google',error);}
  }
  install();
  let tries=0;
  const poll=setInterval(()=>{
    if(install()){upgrade();clearInterval(poll);}
    else if(++tries>120)clearInterval(poll);
  },80);
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>{install();upgrade();},{once:true});
})();