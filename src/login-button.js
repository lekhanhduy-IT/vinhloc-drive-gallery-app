/* Branded pill labels over the genuine Google Identity Services buttons.
   The visible label never receives pointer events: the real GIS iframe
   underneath still handles clicks and account consent securely. */
(() => {
  'use strict';
  if(window.__vlGoogleLargeButtonInstalled)return;
  window.__vlGoogleLargeButtonInstalled=true;
  const ids=new Map([['google-login-btn','Đăng nhập'],['vlSharedGoogleSignin','Đăng nhập']]);
  let patched=null,original=null;
  function config(options){
    const width=Math.max(220,Math.min(290,(innerWidth||390)-88));
    return {...options,type:'standard',size:'large',shape:'pill',
      theme:'outline',text:'signin_with',logo_alignment:'left',
      width,locale:'vi'};
  }
  function skin(target,label){
    if(!target)return;
    target.classList.add('vl-google-login-wide');
    target.style.position='relative';
    target.style.minHeight='46px';
    target.style.maxWidth='290px';
    target.style.width='100%';
    if(target.querySelector('.vl-google-readable-label'))return;
    const overlay=document.createElement('div');
    overlay.className='vl-google-readable-label';
    overlay.style.cssText='position:absolute;inset:1px;z-index:5;border-radius:999px;background:#fff;border:1px solid #d1d5db;display:flex;justify-content:center;align-items:center;gap:11px;color:#202124;font:700 16px system-ui;pointer-events:none;white-space:nowrap;';
    const img=document.createElement('img');
    img.src='https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png';
    img.alt='';img.style.cssText='width:22px;height:22px;object-fit:contain;';
    const text=document.createElement('span');text.textContent=label;
    overlay.append(img,text);target.appendChild(overlay);
  }
  function install(){
    const sdk=window.google?.accounts?.id;
    if(typeof sdk?.renderButton!=='function')return false;
    const fn=sdk.renderButton;
    if(fn===patched || fn.__vlLabelPatch)return true;
    original=fn;
    const wrap=function(element,opts){
      const target=typeof element==='string'?document.querySelector(element):element;
      const label=ids.get(target?.id);
      if(!label)return fn.call(this,element,opts);
      const result=fn.call(this,target,config(opts));
      // The iframe may appear asynchronously after the render call.
      setTimeout(()=>skin(target,label),50);
      return result;
    };
    wrap.__vlLabelPatch=true;
    try{sdk.renderButton=patched=wrap;return true;}catch(_){return false;}
  }
  install();
  // GIS can render the iframe asynchronously or after account selection.
  // Reapply only the harmless visual label, never reinitialize Google auth.
  setInterval(()=>{
    install();
    for(const [id,label] of ids){
      const node=document.getElementById(id);
      if(node?.querySelector('iframe'))skin(node,label);
    }
  },750);
})();