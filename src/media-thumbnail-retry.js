/* Thumbnail recovery after multi-file uploads.
   Drive can acknowledge uploaded bytes before its video previews exist.
   Retry only failed, visible, same-origin thumbnails; never rebuild the grid. */
(() => {
  'use strict';
  if (window.__vlThumbnailRecoveryInstalled) return;
  window.__vlThumbnailRecoveryInstalled = true;
  const delays=[2500,6000,14000,30000,60000,120000];
  const states=new WeakMap();
  const queue=[];
  let active=0;
  const PHOTO_EXTENSION=/\.(?:jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i;
  const MEDIA_ID=/^[A-Za-z0-9_-]{10,160}$/;
  function thumbnailId(raw) {
    if (!isProxy(raw)) return null;
    try {
      const id=new URL(raw,location.href).searchParams.get('fileId');
      return MEDIA_ID.test(id||'')?id:null;
    }catch(_){return null;}
  }
  function imageFile(img) {
    const card=img.closest('#fileList > div');
    const name=card?.querySelector('.drive-img-name')?.textContent?.trim()||'';
    const format=card?.querySelector('.px-1 > span:last-child')?.textContent?.trim()||'';
    return PHOTO_EXTENSION.test(name) || /^(?:JPEG?|PNG|GIF|WEBP|BMP|HEIC|HEIF|AVIF|TIFF?)$/i.test(format);
  }
  function isProxy(raw) {
    try {
      const url=new URL(raw,location.href);
      return url.origin===location.origin && url.pathname==='/api/media' &&
        url.searchParams.get('variant')==='thumb';
    } catch (_) {return false;}
  }
  function itemLabel(img,message) {
    const container=img.parentElement;
    if (!container || !img.closest('#fileList')) return;
    if (getComputedStyle(container).position==='static') container.style.position='relative';
    let label=container.querySelector(':scope > .vl-thumb-status');
    if (!label) {
      label=document.createElement('span');
      label.className='vl-thumb-status';
      label.style.cssText='position:absolute;inset:0;display:flex;justify-content:center;align-items:center;text-align:center;padding:8px;font:600 11px system-ui;background:#f1f5f9;color:#64748b;pointer-events:none;z-index:1;border-radius:8px;';
      container.appendChild(label);
    }
    const videoCard=/(MP4|MOV|QUICKTIME|WEBM|M4V)/i.test(
      container.closest('#fileList > div')?.textContent||'');
    if(videoCard && (message==='Đang xử lý video…'||
                     message==='Drive chưa tạo thumbnail')){
      // Drive may never produce a thumbnail for some codecs. Don't leave
      // the file appearing broken or unclickable; its existing card click
      // still opens the real video player, while retry continues quietly.
      const play=document.createElement('i');
      play.className='fas fa-play-circle text-3xl text-blue-500';
      const caption=document.createElement('span');
      caption.textContent='Xem video';
      caption.style.cssText='font:600 11px system-ui;margin-top:7px;';
      label.replaceChildren(play,caption);
      label.style.flexDirection='column';
    }else{
      label.textContent=message;
      label.style.flexDirection='';
    }
  }
  function clearLabel(img) {
    const sibling=img.parentElement?.querySelector(':scope > .vl-thumb-status');
    if (sibling) sibling.remove();
    img.style.visibility='';
  }
  function enqueue(job) {
    queue.push(job);
    drain();
  }
  function drain() {
    if (active>=2 || !queue.length) return;
    const job=queue.shift();
    active++;
    Promise.resolve().then(job).catch(err=>console.warn('[QL Ảnh] Thumbnail retry',err))
      .finally(()=>{active--;drain();});
  }
  // Drive may copy an image before it has produced a new thumbnailLink.
  // Rescue the *same copied file ID* using the authenticated original bytes,
  // without exposing a Drive URL or replacing any gallery/card nodes.
  async function rescueOriginal(img,state) {
    const fileId=thumbnailId(img.getAttribute('src'));
    if (!fileId || !imageFile(img) || state.originalTried) return false;
    state.originalTried=true;
    const url='/api/media?fileId='+encodeURIComponent(fileId)+'&variant=full';
    itemLabel(img,'Đang lấy ảnh gốc…');
    const succeeded=await new Promise(resolve=>{
      const preview=new Image();
      let settled=false;
      const timeout=setTimeout(()=>finish(false),18000);
      function finish(ok){
        if(settled)return;
        settled=true;
        clearTimeout(timeout);
        preview.onload=null;preview.onerror=null;
        if(!ok)preview.src='';
        resolve(ok);
      }
      preview.onload=()=>finish(preview.naturalWidth>0);
      preview.onerror=()=>finish(false);
      preview.src=url;
    });
    if (!img.isConnected) return false;
    let candidate=succeeded?url:null;
    if(!candidate && typeof window.vlMediaFallbackImage==='function') {
      // /api/media may fail for just-copied files even though Drive can read
      // the same ID through OAuth or the existing bounded Apps Script path.
      itemLabel(img,'Đang khôi phục ảnh từ Drive…');
      try {
        candidate=await window.vlMediaFallbackImage(fileId,false,true);
      } catch(error) {
        state.lastRecoveryError=String(error?.message||error).slice(0,170);
        console.warn('[QL Ảnh] Không thể khôi phục thumbnail',fileId,error);
      }
    }
    if (!candidate || !img.isConnected) return false;
    const probe=await new Promise(resolve=>{
      const preview=new Image();
      const timeout=setTimeout(()=>finish(false),10000);
      let finished=false;
      function finish(ok) {
        if(finished)return;
        finished=true;clearTimeout(timeout);
        preview.onload=null;preview.onerror=null;
        if(!ok)preview.src='';
        resolve(ok);
      }
      preview.onload=()=>finish(preview.naturalWidth>0);
      preview.onerror=()=>finish(false);
      preview.src=candidate;
    });
    if (!probe || !img.isConnected) return false;
    // Keep a working first-party full or verified temporary Blob URL. The
    // media-session reconciler already preserves Blob URLs; it also honors
    // vlOriginalThumb for same-origin full URLs.
    img.dataset.vlOriginalThumb='1';
    img.style.visibility='';
    img.src=candidate;
    clearLabel(img);
    states.delete(img);
    return true;
  }
  function retry(img,state) {
    if(!img.isConnected || !window.vlMediaProxyReady) return;
    if(state.attempt>=delays.length) {
      itemLabel(img,'Chưa có thumbnail');
      return;
    }
    const raw=img.getAttribute('src')||'';
    if(!isProxy(raw)) return;
    const url=new URL(raw,location.href);
    url.searchParams.set('thumbRetry',String(state.attempt+1));
    img.src=url.pathname+url.search;
  }
  function failed(img) {
    if (!window.vlMediaProxyReady || !img.closest('#fileList') || !isProxy(img.getAttribute('src'))) return;
    const prior=states.get(img) || {attempt:0,timer:null,working:false,originalTried:false};
    if (prior.working || prior.timer) return;
    states.set(img,prior);
    img.style.visibility='hidden';
    itemLabel(img,'Đang kiểm tra ảnh…');
    enqueue(async()=>{
      if(!img.isConnected) return;
      prior.working=true;
      try {
        let code=0;
        try {
          const response=await fetch(img.src,{credentials:'same-origin',cache:'no-store'});
          code=response.status;
          // The browser had already tried to display these bytes. Do not
          // download the whole image a second time just to inspect status.
          await response.body?.cancel().catch(()=>{});
        }catch(error){console.warn('[QL Ảnh] Thumbnail request failed',error);}
        if(!img.isConnected) return;
        if(code===401 || code===403) {
          itemLabel(img,'Cần quyền xem ảnh');
          return;
        }
        // A copy may exist before Drive generates its thumbnail. On the
        // first failure try its private original instead of waiting minutes.
        if(await rescueOriginal(img,prior))return;
        if(!img.isConnected)return;
        // 404 (video indexing) and 429/5xx remain transient. Other errors
        // are shown explicitly; do not leave a perpetual loading caption.
        if(code && ![200,404,408,429,500,502,503,504].includes(code)) {
          itemLabel(img,'Không tải được ảnh (HTTP '+code+')');
          return;
        }
        if(prior.attempt>=delays.length) {
          itemLabel(img,prior.lastRecoveryError?
            'Không thể đọc ảnh từ Drive' :
            (code===404?'Drive chưa tạo thumbnail':'Không thể xem thumbnail'));
          if(prior.lastRecoveryError)img.title=prior.lastRecoveryError;
          return;
        }
        const delay=delays[prior.attempt++];
        itemLabel(img,code===404 && !imageFile(img)?'Đang xử lý video…':'Đang tải thumbnail…');
        prior.timer=setTimeout(()=>{
          prior.timer=null;
          retry(img,prior);
        },delay);
      } finally {
        prior.working=false;
      }
    });
  }
  window.addEventListener('error',event=>{
    if(event.target instanceof HTMLImageElement) failed(event.target);
  },true);
  window.addEventListener('load',event=>{
    if(!(event.target instanceof HTMLImageElement)) return;
    const state=states.get(event.target);
    if(state?.timer){clearTimeout(state.timer);state.timer=null;}
    clearLabel(event.target);
    states.delete(event.target);
  },true);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) return;
    for (const img of document.querySelectorAll('#fileList img')) {
      if(isProxy(img.getAttribute('src')) && img.complete && img.naturalWidth===0) failed(img);
    }
  });
})();