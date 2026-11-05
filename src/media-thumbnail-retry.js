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
    const prior=states.get(img) || {attempt:0,timer:null,working:false};
    if (prior.working || prior.timer) return;
    states.set(img,prior);
    img.style.visibility='hidden';
    itemLabel(img,'Đang kiểm tra ảnh…');
    enqueue(async()=>{
      if(!img.isConnected) return;
      prior.working=true;
      try {
        const response=await fetch(img.src,{credentials:'same-origin',cache:'no-store'});
        if(!img.isConnected) return;
        const code=response.status;
        if(code===401 || code===403) {
          itemLabel(img,'Cần quyền xem ảnh');
          return;
        }
        // A 404 video thumbnail indicates Drive is still transcoding it.
        // 429/502/503 are transient. Even an HTTP 200 can still be undecodable
        // (unsupported format), so allow limited retries before stopping.
        if(!response.ok && ![404,408,429,500,502,503,504].includes(code)) {
          itemLabel(img,'Không tải được ảnh');
          return;
        }
        if(prior.attempt>=delays.length) {
          itemLabel(img,code===404?'Drive chưa tạo thumbnail':'Không thể xem thumbnail');
          return;
        }
        const delay=delays[prior.attempt++];
        itemLabel(img,code===404?'Đang xử lý video…':'Đang tải thumbnail…');
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