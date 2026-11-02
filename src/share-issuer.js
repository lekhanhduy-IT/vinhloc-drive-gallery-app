/* Every new folder-share link carries a signed, expiring server grant.
   Ordinary internal QL Ảnh sessions can issue links; share recipients cannot. */
(() => {
  'use strict';
  const params=new URLSearchParams(location.search);
  if(params.has('shareId'))return;
  let last=null;
  async function shareFolder(id,type,name,event,previous){
    if(type!=='folder')return previous?.call(window,id,type,name,event);
    event?.stopPropagation?.();
    document.querySelectorAll('.item-action-menu').forEach(el=>el.classList.add('hidden'));
    try{
      const r=await fetch('/api/owned-files',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'issueShare',folderId:id}),cache:'no-store'
      });
      const json=await r.json();
      if(!r.ok||!json.success||!json.shareGrant)
        throw Error(json.message||'Chưa thể tạo liên kết chia sẻ có quyền truy cập');
      const link=new URL(location.origin+location.pathname);
      link.searchParams.set('shareId',id);
      link.searchParams.set('shareType','folder');
      link.searchParams.set('shareName',name||'Thư mục chia sẻ');
      link.searchParams.set('shareGrant',json.shareGrant);
      if(navigator.share) {
        await navigator.share({title:'Chia sẻ: '+(name||'Thư mục'),url:link.href});
      }else if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(link.href);
        window.showToast?.('Đã sao chép liên kết chia sẻ có giới hạn');
      }else window.prompt('Sao chép liên kết chia sẻ',link.href);
    }catch(err){
      if(err.name==='AbortError')return;
      window.showToast?.('Không tạo được link chia sẻ: '+err.message,true);
      if(rIsUnauthorized(err))window.vlMediaRequireReauth?.();
    }
  }
  function rIsUnauthorized(error){
    return /đăng nhập|xác thực|401|session|quyền/i.test(error.message||'');
  }
  function install(){
    const fn=window.shareItem;
    if(typeof fn!=='function'||fn.__vlShareLinkIssuer)return;
    function wrapped(id,type,name,event){
      return shareFolder(id,type,name,event,fn);
    }
    wrapped.__vlShareLinkIssuer=true;
    last=wrapped;
    window.shareItem=wrapped;
  }
  install();
  setInterval(install,800);
})();