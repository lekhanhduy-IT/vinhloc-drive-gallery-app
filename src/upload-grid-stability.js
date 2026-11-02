/* Keep batch-upload cards mounted; never repaint all cards per completed file.
   This is intentionally DOM-only: the legacy renderer clears #fileList.innerHTML. */
(() => {
  'use strict';
  if (window.vlUploadGrid) return;
  let batch=null;
  let installed=null;
  const cleanupUrls=new Set();
  const currentFolder=()=>{
    try { return typeof currentFolderId!=='undefined' ? currentFolderId : window.currentFolderId; }
    catch(_) {return window.currentFolderId;}
  };
  const selector=id=>'menu-'+id;
  const getCard=id=>document.getElementById(selector(id))?.parentElement?.parentElement||null;
  function install(){
    const current=window.renderItems;
    if(typeof current!=='function'||current===installed||current.__vlStableUploadGuard)return;
    const guard=function(items,isSearchMode=false,...rest) {
      if(batch?.active && batch.initialPaintDone &&
         currentFolder()===batch.folderId && !isSearchMode) {
        // During transfer, the real cache is still updated by caller. Only
        // the destructive full DOM re-render is suppressed.
        return;
      }
      const result=current.call(this,items,isSearchMode,...rest);
      if(batch?.active && !batch.initialPaintDone &&
         currentFolder()===batch.folderId && !isSearchMode)batch.initialPaintDone=true;
      return result;
    };
    guard.__vlStableUploadGuard=true;
    installed=guard;
    window.renderItems=guard;
  }
  function begin(folderId,items){
    install();
    // At most one active batch. All seven placeholder nodes are painted once.
    batch={folderId,active:true,initialPaintDone:false,
      ids:new Set(items.map(x=>x.tempId)),start:Date.now(),progress:new Map()};
  }
  function pendingOverlay(card) {
    return Array.from(card.children).find(el=>
      el.querySelector?.('.loader') && el.textContent?.includes('Đang Up'))||null;
  }
  function updateMessage(id,message,warning=false) {
    const card=getCard(id);
    if(!card)return;
    const overlay=pendingOverlay(card);
    if(!overlay)return;
    const label=Array.from(overlay.querySelectorAll('span')).find(el=>el.textContent?.includes('Đang Up'))||
      overlay.querySelector('span');
    if(label){
      label.textContent=message;
      label.style.color=warning?'#b91c1c':'#2563eb';
    }
    if(warning) overlay.querySelector('.loader')?.remove();
  }
  function settle(tempId,item,tempUrl){
    const previous=getCard(tempId);
    if(!previous || !item?.id)return false;
    const newId=item.id;
    const thumb='https://drive.google.com/thumbnail?id='+encodeURIComponent(newId)+'&sz=w400';
    const full='https://drive.google.com/thumbnail?id='+encodeURIComponent(newId)+'&sz=w2000';
    const overlay=pendingOverlay(previous);
    if(overlay)overlay.remove();
    const menu=document.getElementById(selector(tempId));
    if(menu)menu.id=selector(newId);
    // Update every inline action on this single card, not other cards.
    for(const clickable of previous.querySelectorAll('[onclick]')) {
      const action=clickable.getAttribute('onclick')||'';
      if(action.includes(tempId)) clickable.setAttribute('onclick',action.split(tempId).join(newId));
    }
    const img=previous.querySelector('img.drive-img-item');
    if(img){
      img.dataset.url=full;
      // Never take away the local file preview until the real thumbnail loads.
      if(img.getAttribute('src')!==tempUrl && tempUrl)img.src=tempUrl;
      const preloader=new Image();
      preloader.onload=()=>{
        if(!img.isConnected)return;
        img.src=preloader.src;
        if(tempUrl) {
          // Leave object URL valid until image has switched sources.
          img.addEventListener('load',()=>release(tempUrl),{once:true});
        }
      };
      preloader.onerror=()=>{}; // Keep the already-visible local thumbnail.
      preloader.src=window.vlMediaProxyReady?
        '/api/media?fileId='+encodeURIComponent(newId)+'&variant=thumb':thumb;
    }
    batch?.ids.delete(tempId);
    batch?.progress.set(newId,'success');
    return true;
  }
  function release(url){
    if(!url||cleanupUrls.has(url))return;
    cleanupUrls.add(url);
    try{URL.revokeObjectURL(url)}catch(_){}
  }
  function failed(id,error){
    updateMessage(id,'Chưa xác nhận trên Drive',true);
    const card=getCard(id);
    if(card)card.title='Lệnh upload chưa xác nhận: '+String(error||'Kiểm tra mạng');
    batch?.progress.set(id,'unconfirmed');
    // Do not erase the card: a Drive upload can complete despite Safari's
    // fetch throwing "Load failed" after sending the request bytes.
  }
  function finish(){
    if(!batch)return;
    batch.active=false;
    // Do not repaint on completion. Any future explicit navigation or sync
    // can render the final cache normally.
    batch=null;
  }
  window.addEventListener('pagehide',()=>{
    for(const url of cleanupUrls)URL.revokeObjectURL(url);
  });
  window.vlUploadGrid={begin,settle,failed,finish,release,install,
    isActive:()=>!!batch?.active,
    folderId:()=>batch?.folderId||null,
    suppressFor:id=>!!batch?.active&&id===batch.folderId,
    retrying:updateMessage};
  install();
  setInterval(install,900);
})();