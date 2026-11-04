/* Keep batch-upload cards mounted; never repaint all cards per completed file.
   This is intentionally DOM-only: the legacy renderer clears #fileList.innerHTML. */
(() => {
  'use strict';
  if (window.vlUploadGrid) return;
  let batch=null;
  let installed=null;
  const cleanupUrls=new Set();
  let activeGroups=0;
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
         currentFolder()===batch.folderId && !isSearchMode &&
         document.getElementById('fileList')?.dataset.vlRenderedFolder===batch.folderId) {
        // During transfer, the real cache is still updated by caller. Only
        // the destructive full DOM re-render is suppressed.
        return;
      }
      const result=current.call(this,items,isSearchMode,...rest);
      if(!isSearchMode){
        const list=document.getElementById('fileList');
        if(list)list.dataset.vlRenderedFolder=currentFolder()||'';
      }
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
    const list=document.getElementById('fileList');
    const append=!!(batch?.active && batch.initialPaintDone &&
      currentFolder()===folderId && batch.folderId===folderId &&
      list?.dataset.vlRenderedFolder===folderId);
    if(!batch || !batch.active || batch.folderId!==folderId){
      batch={folderId,active:true,initialPaintDone:false,
        ids:new Set(),start:Date.now(),progress:new Map()};
    }
    activeGroups++;
    for(const item of items)batch.ids.add(item.tempId);
    return append;
  }
  // Add only the new cards: a complete render would replace earlier local
  // previews and their independent transfer indicators.
  function appendPending(folderId,items){
    const list=document.getElementById('fileList');
    if(!list || currentFolder()!==folderId)return;
    const fragment=document.createDocumentFragment();
    for(const item of items){
      if(getCard(item.tempId))continue;
      const card=document.createElement('div');
      card.className='p-2.5 rounded-2xl shadow-sm border flex flex-col relative transition border-gray-100 bg-white';
      const anchor=document.createElement('div');
      anchor.className='absolute top-2 right-2 z-20';
      const marker=document.createElement('div');
      marker.id=selector(item.tempId);
      marker.className='hidden item-action-menu';
      anchor.appendChild(marker);
      card.appendChild(anchor);
      const preview=document.createElement('div');
      preview.className='w-full h-32 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden mb-3';
      if((item.file.type||'').startsWith('image/')){
        const img=document.createElement('img');
        img.className='w-full h-full object-cover drive-img-item';
        img.src=item.tempUrl;img.dataset.url=item.tempUrl;img.loading='lazy';
        preview.appendChild(img);
      }else{
        const icon=document.createElement('i');icon.className='fas fa-play-circle text-gray-400 text-4xl';
        preview.appendChild(icon);
      }
      card.appendChild(preview);
      const caption=document.createElement('div');
      caption.className='px-1 flex flex-col justify-center flex-1';
      const name=document.createElement('span');
      name.className='text-[13px] font-bold text-gray-800 line-clamp-2 leading-tight';
      name.textContent=item.file.name;
      const type=document.createElement('span');
      type.className='text-[10px] text-gray-400 mt-1 uppercase font-semibold';
      type.textContent=(item.file.type||'file').split('/').pop();
      caption.append(name,type);card.appendChild(caption);
      const overlay=document.createElement('div');
      overlay.className='absolute inset-0 bg-white/60 flex flex-col items-center justify-center backdrop-blur-[2px] z-10 rounded-2xl';
      overlay.dataset.vlPendingOverlay='1';
      const spinner=document.createElement('div');
      spinner.className='loader mb-2 border-blue-600';
      const label=document.createElement('span');
      label.className='text-[10px] font-bold text-blue-600';
      label.textContent='Đang chờ tải...';
      overlay.append(spinner,label);
      card.appendChild(overlay);
      fragment.appendChild(card);
    }
    list.prepend(fragment);
  }
  function pendingOverlay(card) {
    return Array.from(card.children).find(el=>
      (el.dataset?.vlPendingOverlay==='1' ||
      (el.querySelector?.('.loader') && /Đang Up|Đang chờ/.test(el.textContent||''))))||null;
  }
  function updateMessage(id,message,warning=false) {
    const card=getCard(id);
    if(!card)return;
    const overlay=pendingOverlay(card);
    if(!overlay)return;
    const label=overlay.querySelector('span');
    if(label){
      label.textContent=message;
      label.style.color=warning?'#b91c1c':'#2563eb';
    }
    if(warning) overlay.querySelector('.loader')?.remove();
  }
  function markUploading(id){updateMessage(id,'Đang Up...');}
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
    activeGroups=Math.max(0,activeGroups-1);
    if(activeGroups>0)return;
    if(batch)batch.active=false;
    batch=null;
  }
  window.addEventListener('pagehide',()=>{
    for(const url of cleanupUrls)URL.revokeObjectURL(url);
  });
  window.vlUploadGrid={begin,appendPending,markUploading,settle,failed,finish,release,install,
    isActive:()=>!!batch?.active,
    folderId:()=>batch?.folderId||null,
    suppressFor:id=>!!batch?.active&&id===batch.folderId,
    retrying:updateMessage};
  install();
  setInterval(install,900);
})();