/* The branded "Đăng nhập" pill exactly covers Google's OWN clickable iframe.
   Never draw a larger visual button than the real Google Identity Services
   control, and never hijack or synthesize a click on the Google widget. */
(() => {
  'use strict';
  if(window.__vlGoogleLargeButtonInstalled)return;
  window.__vlGoogleLargeButtonInstalled=true;
  const labels=new Map([
    ['google-login-btn','Đăng nhập'],
    ['vlSharedGoogleSignin','Đăng nhập']
  ]);
  let patched=null;
  function preferredWidth(){
    return Math.max(210,Math.min(290,(window.innerWidth||390)-88));
  }
  function config(options={}){
    return {...options,type:'standard',size:'large',shape:'pill',
      theme:'outline',text:'signin_with',logo_alignment:'left',
      width:preferredWidth(),locale:'vi'};
  }
  function skin(node,label){
    if(!node)return;
    const iframe=node.querySelector('iframe');
    if(!iframe||!iframe.isConnected)return;
    // Use the iframe as the only source of truth for the clickable geometry.
    // A label wider/taller than the iframe would look clickable but be inert.
    const width=iframe.offsetWidth||iframe.getBoundingClientRect().width;
    const height=iframe.offsetHeight||iframe.getBoundingClientRect().height;
    if(!width||!height)return;
    node.style.position='relative';
    node.style.boxSizing='border-box';
    node.style.width=width+'px';
    node.style.minHeight='0px';
    node.style.height=height+'px';
    node.style.maxWidth='none';
    node.style.overflow='visible';
    iframe.style.pointerEvents='auto';
    const left=iframe.offsetLeft||0,top=iframe.offsetTop||0;
    let cover=node.querySelector('.vl-google-readable-label');
    if(!cover){
      cover=document.createElement('span');
      cover.className='vl-google-readable-label';
      cover.setAttribute('aria-hidden','true');
      cover.style.cssText='position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:999px;background:#fff;border:1px solid #dadce0;box-sizing:border-box;color:#202124;font:700 16px system-ui;pointer-events:none!important;white-space:nowrap;user-select:none;-webkit-user-select:none;';
      const logo=document.createElement('img');
      logo.src='https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png';
      logo.alt='';logo.style.cssText='width:22px;height:22px;object-fit:contain;pointer-events:none!important;';
      const text=document.createElement('span');
      text.textContent=label;
      text.style.pointerEvents='none';
      cover.append(logo,text);
      node.appendChild(cover);
    }
    cover.style.left=left+'px';
    cover.style.top=top+'px';
    cover.style.width=width+'px';
    cover.style.height=height+'px';
    node.dataset.vlGoogleLabelReady='1';
  }
  function install(){
    const sdk=window.google?.accounts?.id;
    if(typeof sdk?.renderButton!=='function')return false;
    const base=sdk.renderButton;
    if(base===patched || base.__vlClickAreaPatched)return true;
    function wrapper(target,options){
      const node=typeof target==='string'?document.querySelector(target):target;
      const label=labels.get(node?.id);
      if(!label)return base.call(this,target,options);
      const out=base.call(this,node,config(options));
      // The Google iframe is created asynchronously on some iOS versions.
      setTimeout(()=>skin(node,label),80);
      return out;
    }
    wrapper.__vlClickAreaPatched=true;
    try{sdk.renderButton=patched=wrapper;return true;}catch(_){return false;}
  }
  install();
  setInterval(()=>{
    install();
    for(const [id,label] of labels){
      const node=document.getElementById(id);
      if(node?.querySelector('iframe'))skin(node,label);
    }
  },700);
})();