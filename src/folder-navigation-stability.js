/* Preserve scroll per physical folder and protect delete from navigation jumps.
   Works with mega-row virtual hierarchies and the legacy obfuscated navigator. */
(() => {
  'use strict';
  if(window.vlFolderScrollMemory)return;
  const content=document.getElementById('contentArea');
  if(!content)return;
  const STORAGE='vl-folder-scroll-v1';
  const history=new Map();
  try {
    const obj=JSON.parse(sessionStorage.getItem(STORAGE)||'{}');
    for(const [key,value] of Object.entries(obj))if(Number.isFinite(value)&&value>=0)history.set(key,value);
  }catch(_){}
  const getId=()=>{
    try{return typeof currentFolderId!=='undefined'?String(currentFolderId):String(window.currentFolderId||'');}
    catch(_){return String(window.currentFolderId||'');}
  };
  const getCat=()=>{
    try{return typeof currentCategory!=='undefined'?String(currentCategory):'';}
    catch(_){return '';}
  };
  const key=id=>getCat()+':'+id;
  let tracked=getId(), pending=null, lastScroll=content.scrollTop;
  let deleting=false, installed=null, saveTimer=null, timeout=null;
  let restoreGeneration=0, navigationIntentUntil=0, watchRestore=null;
  function persist(){
    if(saveTimer!==null)return;
    saveTimer=setTimeout(()=>{
      saveTimer=null;
      try{sessionStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries([...history].slice(-120))));}catch(_){}
    },180);
  }
  function record(id=tracked,scroll=content.scrollTop){
    if(!id || !Number.isFinite(scroll))return;
    history.delete(key(id));
    history.set(key(id),Math.max(0,scroll));
    persist();
  }
  function stopRestore(){pending=null;restoreGeneration++;if(timeout){clearTimeout(timeout);timeout=null;}}
  function tryRestore(generation) {
    if(!pending||generation!==restoreGeneration || tracked!==pending.id)return;
    if(Date.now()>pending.deadline){stopRestore();return;}
    const max=content.scrollHeight-content.clientHeight;
    if(max>=pending.y-2){
      content.scrollTop=pending.y;
      lastScroll=content.scrollTop;
      if(Math.abs(content.scrollTop-pending.y)<4){
        watchRestore={id:pending.id,y:pending.y,until:Date.now()+3500};
        stopRestore();
        return;
      }
    }
    timeout=setTimeout(()=>{timeout=null;tryRestore(generation);},110);
  }
  function restore(id){
    stopRestore();
    const y=history.get(key(id));
    if(!(y>3))return;
    pending={id,y,deadline:Date.now()+6500};
    const gen=restoreGeneration;
    requestAnimationFrame(()=>tryRestore(gen));
  }
  function sync(){
    const now=getId();
    if(!now || now===tracked)return;
    if(Date.now()>navigationIntentUntil)record(tracked,lastScroll);
    tracked=now;
    watchRestore=null;
    navigationIntentUntil=0;
    lastScroll=content.scrollTop;
    restore(now);
  }
  content.addEventListener('scroll',()=>{
    if(pending)return;
    sync();
    if(pending || Date.now()<navigationIntentUntil)return;
    if(watchRestore && watchRestore.id===tracked && Date.now()<watchRestore.until &&
        content.scrollTop<watchRestore.y-15) {
      if(content.scrollHeight-content.clientHeight>=watchRestore.y-2)
        content.scrollTop=watchRestore.y;
      return;
    }
    watchRestore=null;
    lastScroll=content.scrollTop;
    record(tracked,lastScroll);
  },{passive:true});
  // Touch/scrolling by the user cancels restoration to prevent fighting them.
  const cancel=()=>{watchRestore=null;navigationIntentUntil=0;if(pending)stopRestore();};
  content.addEventListener('touchstart',cancel,{passive:true});
  content.addEventListener('pointerdown',cancel,{passive:true});
  content.addEventListener('wheel',cancel,{passive:true});
  document.addEventListener('click',event=>{
    const node=event.target?.closest?.('#btnBack,[onclick*="loadFolder"],.subfolder-row,.mega-header');
    if(node) {
      if(!pending && tracked)record(tracked,content.scrollTop);
      navigationIntentUntil=Date.now()+1800;
    }
    queueMicrotask(sync);
  },true);
  const observer=new MutationObserver(()=>{
    sync();
    if(pending)tryRestore(restoreGeneration);
    else if(watchRestore && watchRestore.id===tracked &&
        Date.now()<watchRestore.until &&
        content.scrollTop<watchRestore.y-15 &&
        content.scrollHeight-content.clientHeight>=watchRestore.y-2)
      content.scrollTop=watchRestore.y;
  });
  observer.observe(document.getElementById('folderList')||content,{childList:true,subtree:false});
  observer.observe(document.getElementById('fileList')||content,{childList:true,subtree:false});
  function installGuard(){
    const previous=window.loadFolder;
    if(typeof previous!=='function' || previous===installed || previous.__vlNoDeleteBounce)return;
    const wrapped=function(id,...args){
      if(deleting && String(id)!==getId())return Promise.resolve(false);
      if(tracked && !pending)record(tracked,content.scrollTop);
      const result=previous.apply(this,[id,...args]);
      queueMicrotask(sync);
      return result;
    };
    // Preserve the shared-folder navigation marker. Otherwise its 550ms
    // installer and this guard would repeatedly wrap one another forever.
    if(previous.__vlShareBound) wrapped.__vlShareBound=true;
    wrapped.__vlNoDeleteBounce=true;
    installed=wrapped;
    window.loadFolder=wrapped;
  }
  document.addEventListener('vl:delete-start',evt=>{
    sync();
    deleting=true;
    stopRestore();
    record(tracked,evt.detail?.scrollTop??content.scrollTop);
  });
  document.addEventListener('vl:delete-end',evt=>{
    deleting=false;
    const id=evt.detail?.folderId;
    if(id===getId()) {
      tracked=id;
      const y=Math.max(0,evt.detail?.scrollTop||0);
      history.set(key(id),y);
      restore(id);
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){if(!pending)record(tracked,content.scrollTop);}
    else sync();
  });
  window.addEventListener('pageshow',sync);
  installGuard();
  setInterval(()=>{installGuard();sync();},140);
  window.vlFolderScrollMemory={save:()=>record(tracked,content.scrollTop),restore:()=>restore(getId())};
})();
