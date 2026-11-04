/* Local video poster + deterministic player for fresh uploads.
   Kept in this tab only; no Drive permission is granted by a local preview. */
(() => {
  'use strict';
  if(window.vlVideoMediaBridge)return;
  const entries=new Map(), currentById=new Map();
  const KEEP_MS=180000;
  const videoType=item=>item && (
    String(item.mimeType||'').startsWith('video/') ||
    /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(String(item.name||'')));
  const folder=()=>{
    try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){return window.currentFolderId;}
  };
  const list=()=>{
    try{return typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems||[];}
    catch(_){return window.currentDriveItems||[];}
  };
  const findCard=id=>document.getElementById('menu-'+id)?.parentElement?.parentElement||null;
  function previewFor(file,url){
    return new Promise(resolve=>{
      const video=document.createElement('video');
      video.muted=true;video.playsInline=true;video.preload='auto';
      let done=false;
      const timer=setTimeout(()=>finish(),9500);
      function finish(result=null){
        if(done)return;
        done=true;clearTimeout(timer);
        video.pause();video.removeAttribute('src');video.load();
        resolve(result);
      }
      function shot(){
        try{
          if(!video.videoWidth||!video.videoHeight)return;
          const canvas=document.createElement('canvas');
          const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
          canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
          canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
          canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
          canvas.toBlob(b=>finish(b?URL.createObjectURL(b):null),'image/jpeg',0.82);
        }catch(_){finish();}
      }
      video.onloadeddata=shot;
      video.onseeked=shot;
      video.onerror=()=>finish();
      video.src=url;
      video.load();
    });
  }
  function queued(id,file,tempUrl,destination){
    if(!videoType({mimeType:file.type,name:file.name})||entries.has(id))return;
    const entry={id,file,poster:null,localUrl:URL.createObjectURL(file),
      destination,confirmedAt:0,createdAt:Date.now()};
    entries.set(id,entry);
    void previewFor(file,entry.localUrl).then(poster=>{
      if(!entries.has(entry.id)){if(poster)URL.revokeObjectURL(poster);return;}
      entry.poster=poster;
      updateGrid();
    });
    updateGrid();
  }
  function confirmed(tempId,realId){
    const item=entries.get(tempId);
    if(!item||!realId)return;
    entries.delete(tempId);
    item.id=realId;
    item.confirmedAt=Date.now();
    entries.set(realId,item);
    updateGrid();
  }
  function release(id){
    const item=entries.get(id);
    if(!item)return;
    entries.delete(id);
    if(item.poster)URL.revokeObjectURL(item.poster);
    if(item.localUrl)URL.revokeObjectURL(item.localUrl);
  }
  function setCardPoster(card,entry){
    const preview=card?.querySelector('.h-32');
    if(!preview)return;
    if(preview.dataset.vlLocalPoster===entry.id && (entry.poster?preview.querySelector('img'):preview.querySelector('.fa-play-circle')))return;
    preview.dataset.vlLocalPoster=entry.id;
    if(!entry.poster){
      // Never start a Drive thumbnail request for a file that is still
      // being uploaded or whose transcoded thumbnail is not ready.
      preview.replaceChildren();
      const icon=document.createElement('i');
      icon.className='fas fa-play-circle text-blue-500 text-4xl';
      preview.appendChild(icon);
      return;
    }
    const img=document.createElement('img');
    img.src=entry.poster;
    img.alt='Ảnh xem trước video';
    img.className='w-full h-full object-cover';
    preview.replaceChildren(img);
  }
  function itemIndex(){
    const values=new Map();
    const items=list();
    for(const item of items||[])if(item?.id)values.set(item.id,item);
    const cache=window.folderDataCache;
    for(const item of cache?.[folder()]||[])if(item?.id&&!values.has(item.id))values.set(item.id,item);
    return values;
  }
  function updateGrid(){
    const root=document.getElementById('fileList');
    if(!root)return;
    const items=itemIndex();
    for(const menu of root.querySelectorAll('[id^="menu-"]')){
      const id=menu.id.slice(5),card=menu.parentElement?.parentElement;
      const entry=entries.get(id),item=items.get(id);
      if(entry){
        if(entry.destination===folder())setCardPoster(card,entry);
      }else if(videoType(item)&&
        item.recentlyUploadedAt&&Date.now()-item.recentlyUploadedAt<12*60000){
        // Safely render a play icon instead of leaving a 403/404 thumbnail
        // fetching indefinitely. The viewer verifies the real Drive file.
        const box=card?.querySelector('.h-32');
        if(box && !box.dataset.vlRecentVideo){
          box.dataset.vlRecentVideo='1';
          const icon=document.createElement('i');
          icon.className='fas fa-play-circle text-blue-500 text-4xl';
          box.replaceChildren(icon);
        }
      }
    }
  }
  function isVideo(id,mime,name){
    if(String(mime||'').startsWith('video/'))return true;
    if(/\.(mp4|mov|m4v|webm)$/i.test(String(name||'')))return true;
    return !!entries.get(id);
  }
  function installPlayer(){
    const previous=window.openMedia;
    if(typeof previous!=='function'||previous.__vlVideoPlayer)return;
    const wrapped=function(id,mime,name,url){
      if(!isVideo(id,mime,name))return previous.apply(this,arguments);
      const result=previous.apply(this,arguments);
      const container=document.getElementById('mediaContent');
      if(!container)return result;
      const player=document.createElement('video');
      player.controls=true;player.playsInline=true;
      player.preload='metadata';
      player.className='max-w-full max-h-full object-contain';
      player.style.background='#000';
      player.src=entries.get(id)?.localUrl ||
        '/api/media?fileId='+encodeURIComponent(id)+'&variant=full';
      const errorMsg=document.createElement('p');
      errorMsg.style.cssText='color:#fff;text-align:center;font-size:13px;margin-top:12px;';
      player.addEventListener('error',()=>{
        errorMsg.textContent='Chưa thể phát video. Đang kiểm tra trạng thái lưu trữ và quyền xem trên Drive…';
        if(!errorMsg.isConnected)container.appendChild(errorMsg);
        const probe='/api/media?fileId='+encodeURIComponent(id)+'&variant=full';
        // Fetch only the first byte, not an entire 4K video.
        void fetch(probe,{credentials:'same-origin',headers:{Range:'bytes=0-0'}})
          .then(async response=>{
            if(response.ok){errorMsg.textContent='Video chưa tương thích với trình phát của trình duyệt. Có thể tải file gốc xuống để xem.';return;}
            const data=await response.json().catch(()=>({}));
            errorMsg.textContent=(response.status===403?
              'Drive chưa xác nhận video thuộc kho ảnh được cấp quyền. ': 
              response.status===401?'Phiên xem video hết hạn. ':
              'Không phát được video. ')+(data.message||'HTTP '+response.status);
            if(response.status===401)void window.vlMediaEnsureAuth?.();
          }).catch(()=>{errorMsg.textContent='Không kết nối được đến máy chủ phát video.';});
      },{once:true});
      container.replaceChildren(player);
      return result;
    };
    wrapped.__vlVideoPlayer=true;
    window.openMedia=wrapped;
  }
  let task=null;
  const root=document.getElementById('fileList');
  if(root)new MutationObserver(()=>{
    if(task!==null)return;
    task=setTimeout(()=>{task=null;updateGrid();},90);
  }).observe(root,{childList:true,subtree:true});
  setInterval(()=>{
    installPlayer();
    updateGrid();
    for(const [id,item]of entries)
      if(item.confirmedAt&&Date.now()-item.confirmedAt>KEEP_MS)release(id);
  },1100);
  installPlayer();
  window.vlVideoMediaBridge={queued,confirmed,release,updateGrid};
})();