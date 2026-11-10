/* Cross-device cache hydrator and continuous background folder crawler.
   The old 8-second spider/IndexedDB queue were DEVICE-LOCAL. This uses a
   permission-checked Redis index, while rendering the same existing app UI.
   It does not download private media into a global public cache. */
(() => {
  'use strict';
  if(window.vlSharedPreload)return;
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const ID=/^[A-Za-z0-9_-]{10,180}$/;
  const API='/api/folder-cache';
  const FRESH=10*60*1000;
  const RETRY=90*1000;
  const WORKERS=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)?1:2;
  const queued=new Set(),queue=[],verified=new Map(),verifiedItems=new Map();
  const serverPermitted=new Set(),refreshTimers=new Map();
  let cacheHealthy=false;
  let auth=false,booting=false,failedUntil=0,active=0,lastAuth=0;
  let flushTimer=null,bootedScope='',lastSnapshot=0;
  const localCache=()=>{
    try{return typeof folderDataCache!=='undefined'?folderDataCache:window.folderDataCache;}
    catch(_){return window.folderDataCache;}
  };
  const subCache=()=>{
    try{return typeof subFolderCache!=='undefined'?subFolderCache:window.subFolderCache;}
    catch(_){return window.subFolderCache;}
  };
  const activeFolder=()=>{
    try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){return window.currentFolderId;}
  };
  function scope(){
    if(window.vlShareScope){
      return window.vlShareScope.ready?.()?window.vlShareScope.root:'';
    }
    return localStorage.getItem('vinhloc_authenticated_email')?ROOT:'';
  }
  const pending=item=>item?.isPending||
    String(item?.id||'').startsWith('temp_file_')||
    !!(item?.recentlyUploadedAt&&Date.now()-item.recentlyUploadedAt<120000);
  function push(id,urgent=false){
    if(!ID.test(id)||queued.has(id))return;
    if(window.vlShareScope &&
       !window.vlShareScope.allowed?.(id) && !serverPermitted.has(id))return;
    queued.add(id);
    if(urgent)queue.unshift(id);
    else queue.push(id);
  }
  function discover(items){
    if(!Array.isArray(items))return;
    for(const item of items){
      if(item?.type==='folder'&&ID.test(item.id)){
        serverPermitted.add(item.id);
        push(item.id);
      }
    }
  }
  function saveEventually(){
    if(flushTimer!==null)return;
    flushTimer=setTimeout(async()=>{
      flushTimer=null;
      const store=window.localforage;
      if(!store)return;
      try{
        const cache=localCache(),sub=subCache();
        if(cache)await store.setItem('vinhloc_folder_cache',cache);
        if(sub)await store.setItem('vinhloc_subfolder_cache',sub);
      }catch(error){
        console.warn('[QL Ảnh] Không lưu được cache ngầm của thiết bị',error);
      }
    },1400);
  }
  function apply(id,items,updatedAt,mode='snapshot',viewerEmail=''){
    if(!ID.test(id)||!Array.isArray(items))return;
    if(window.vlShareScope &&
       !window.vlShareScope.allowed?.(id) && !serverPermitted.has(id))return;
    verified.set(id,Number(updatedAt)||Date.now());
    verifiedItems.set(id,items);
    if(viewerEmail){
      // Metadata from a scope-verified, same-origin Redis snapshot.
      // Events never carry Google tokens or the underlying private image.
      window.dispatchEvent(new CustomEvent('vl:verified-folder-snapshot',{
        detail:{folderId:id,items,viewerEmail:String(viewerEmail).toLowerCase(),
          updatedAt:Number(updatedAt)||Date.now()}
      }));
    }
    const cache=localCache(),sub=subCache();
    if(!cache)return;
    const old=Array.isArray(cache[id])?cache[id]:null;
    // A server snapshot is never allowed to overwrite a locally edited
    // folder or a currently uploading card. Fresh Drive lists may update it.
    const incoming=items.filter(item=>ID.test(item?.id)&&!item.isPending);
    const live=mode==='drive';
    const oldPending=(old||[]).filter(pending);
    // Another device can have older IndexedDB content from yesterday.
    // A recent server-verified snapshot wins for non-active folders, unless
    // this device is uploading/editing those items right now.
    const newerServer=mode==='snapshot' &&
      Date.now()-Number(updatedAt||0)<FRESH &&
      id!==activeFolder() && oldPending.length===0;
    if(!old || live || newerServer){
      const ids=new Set(oldPending.map(item=>item.id));
      cache[id]=[...oldPending,...incoming.filter(item=>!ids.has(item.id))];
      if(sub)sub[id]=cache[id].filter(item=>item.type==='folder');
      saveEventually();
      // Paint only if the legacy app is still showing its loading placeholder.
      const folderList=document.getElementById('folderList');
      const fileList=document.getElementById('fileList');
      if(activeFolder()===id&&
        folderList?.textContent?.includes('Đang tải dữ liệu')&&
        fileList?.childElementCount===0&&
        !document.getElementById('searchInput')?.value.trim()&&
        typeof window.renderItems==='function'){
        try{window.renderItems(cache[id]);}
        catch(error){console.warn('[QL Ảnh] Không vẽ được dữ liệu đã nạp',error);}
      }
    }
    discover(items);
  }
  async function call(action,args={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),24000);
    try{
      const response=await fetch(API,{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({action,...args})
      });
      const data=await response.json().catch(()=>({}));
      if(response.status===401){auth=false;throw Error('Chưa có phiên Google đã xác thực');}
      if(!response.ok||data.success!==true)
        throw Error(data.message||'Folder cache HTTP '+response.status);
      cacheHealthy=true;
      return data;
    }finally{clearTimeout(timer);}
  }
  async function authorized(){
    if(Date.now()-lastAuth<15000)return auth;
    lastAuth=Date.now();
    try{
      const res=await fetch('/api/media?status=1',{credentials:'same-origin',cache:'no-store'});
      if(!res.ok){auth=false;return false;}
      const state=await res.json();
      auth=state.success===true &&
        (!window.vlShareScope||state.scopeRoot===window.vlShareScope.root);
      return auth;
    }catch(_){return false;}
  }
  function disableOldSpider(){
    // Prevent old concurrent crawling from rewriting the same cache with
    // stale per-device data. Leave it enabled if the Redis service is down.
    if(!cacheHealthy)return;
    if(window.spiderInterval){
      clearInterval(window.spiderInterval);
      window.spiderInterval=null;
    }
  }
  async function snapshot(){
    if(window.vlShareScope)return;
    let offset=0,rounds=0;
    do{
      if(!auth||document.hidden)return;
      const page=await call('snapshot',{offset,limit:12});
      for(const item of page.entries||[])apply(item.id,item.items,item.updatedAt,'snapshot',page.viewerEmail);
      offset=Number(page.nextOffset)||0;
      rounds++;
      // Bounded work. Future ticks resume remaining pages on demand.
      if(!page.hasMore)break;
      if(rounds%8===0)await new Promise(r=>setTimeout(r,100));
    }while(rounds<1000 && scope()===bootedScope);
    lastSnapshot=Date.now();
  }
  async function boot(){
    if(booting||Date.now()<failedUntil)return;
    const currentScope=scope();
    if(!currentScope)return;
    if(!await authorized())return;
    booting=true;
    try{
      if(bootedScope!==currentScope){
        bootedScope=currentScope;
        queue.length=0;queued.clear();verified.clear();verifiedItems.clear();serverPermitted.clear();
        serverPermitted.add(currentScope);
        push(currentScope,true);
        // The primary screen starts warming immediately. Fetch the entire
        // shared index in parallel; it may be thousands of folders.
        work();
        if(!window.vlShareScope)await snapshot();
      }
      disableOldSpider();
      // Start warming instantly instead of waiting for the legacy
      // spider's seven-second startup plus eight-second interval.
      work();
    }catch(error){
      failedUntil=Date.now()+RETRY;
      console.warn('[QL Ảnh] Dùng cache cục bộ, cache liên thiết bị chưa sẵn sàng',error);
    }finally{booting=false;}
  }
  async function warm(id,force=false){
    const result=await call('warm',{folderId:id,force});
    apply(id,result.data,result.updatedAt,result.source==='drive'?'drive':'snapshot',result.viewerEmail);
    return result;
  }
  function work(){
    if(!auth||!scope()||document.hidden||Date.now()<failedUntil)return;
    while(active<WORKERS && queue.length){
      const id=queue.shift();
      queued.delete(id);
      const recent=verified.get(id);
      if(recent && Date.now()-recent<FRESH){
        discover(localCache()?.[id]);
        continue;
      }
      active++;
      void warm(id).catch(error=>{
        console.warn('[QL Ảnh] Nạp trước thư mục '+id,error);
        failedUntil=Date.now()+15000;
        push(id);
      }).finally(()=>{active--;});
    }
  }
  function onVisible(){
    if(!scope())return;
    if(!auth||bootedScope!==scope())void boot();
    else{
      if(Date.now()-lastSnapshot>30*60*1000 && !window.vlShareScope)
        void snapshot().catch(error=>console.warn('[QL Ảnh] Snapshot',error));
      work();
    }
  }
  // Fast lookup for browsers that already learned this folder from another
  // warmed session, without an additional Drive operation.
  async function hydrateFolder(id){
    if(!ID.test(id)||!auth)return false;
    if(window.vlShareScope&&!window.vlShareScope.allowed?.(id)&&
       !serverPermitted.has(id))return false;
    const response=await call('get',{folderId:id});
    apply(id,response.data,response.updatedAt,'snapshot',response.viewerEmail);
    return true;
  }
  function refreshFolder(id){
    if(!ID.test(id)||!scope())return;
    if(refreshTimers.has(id))clearTimeout(refreshTimers.get(id));
    const timer=setTimeout(async()=>{
      refreshTimers.delete(id);
      if(!auth){push(id,true);return;}
      try{
        const result=await call('warm',{folderId:id,force:true});
        apply(id,result.data,result.updatedAt,'drive');
      }catch(error){
        console.warn('[QL Ảnh] Sẽ cập nhật lại cache folder khi có mạng',error);
        verified.delete(id);
        push(id,true);
      }
    },1600);
    refreshTimers.set(id,timer);
  }
  function protectSnapshot(snapshot){
    // Legacy Patch 54 imports a whole separate global-cache JSON and
    // overwrites RAM. Retain recent, verified shared-server entries so
    // its slow response cannot undo a faster cross-device preload.
    if(!snapshot||typeof snapshot!=='object')return;
    snapshot.folderData ||= {};
    snapshot.subData ||= {};
    const now=Date.now();
    for(const [id,items] of verifiedItems){
      if(!Array.isArray(items)||now-(verified.get(id)||0)>FRESH)continue;
      const pendingLocal=(snapshot.folderData[id]||[]).filter(pending);
      const localIds=new Set(pendingLocal.map(item=>item.id));
      snapshot.folderData[id]=[
        ...pendingLocal,...items.filter(item=>!localIds.has(item.id))
      ];
      snapshot.subData[id]=snapshot.folderData[id].filter(item=>item.type==='folder');
    }
  }
  window.vlSharedPreload={hydrateFolder,refreshFolder,protectSnapshot,refresh:()=>void boot(),
    status:()=>({cached:verified.size,queued:queue.length,active,authorized:auth,
      sharedCacheReady:cacheHealthy})};
  for(const event of ['vl:media-authorized','vl:share-member-ready'])
    window.addEventListener(event,()=>{lastAuth=0;void boot();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)onVisible();});
  window.addEventListener('online',onVisible);
  // When a user navigates quickly to a folder not yet reached by the BFS,
  // prioritize that folder for the next operation.
  document.addEventListener('click',event=>{
    const row=event.target.closest?.('.subfolder-row,.mega-row,.mega-header');
    if(!row)return;
    const handler=row.getAttribute('onclick')||'';
    const match=handler.match(/(?:loadFolder|toggleMegaRow)\s*\(\s*['"]([A-Za-z0-9_-]{10,180})/);
    if(match){
      push(match[1],true);
      // A just-clicked cold folder gets first priority: show Redis data as
      // soon as possible, without waiting behind a long BFS crawl.
      if(auth&&!Array.isArray(localCache()?.[match[1]]))
        void hydrateFolder(match[1]).catch(()=>{});
    }
  },true);
  setInterval(()=>{
    if(!scope())return;
    if(!auth)void boot();
    else {
      disableOldSpider();
      work();
    }
  },2000);
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',()=>void boot(),{once:true});
  else void boot();
})();