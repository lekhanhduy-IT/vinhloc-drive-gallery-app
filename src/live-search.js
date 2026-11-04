/* Search only verified, non-trashed Drive items. Legacy search scans
   stale IndexedDB and appMeta: intercept at capture before its input handlers. */
(() => {
  'use strict';
  if(window.__vlLiveSearchInstalled)return;
  window.__vlLiveSearchInstalled=true;
  const inputId='searchInput';
  let generation=0,timer=null,controller=null,items=[],limit=30,searching=false;

  const byId=id=>document.getElementById(id);
  const keyword=()=>String(byId(inputId)?.value||'').trim();
  const setClear=visible=>byId('clearSearchBtn')?.classList.toggle('hidden',!visible);
  function message(text,isError=false){
    const folder=byId('folderList'),files=byId('fileList');
    if(!folder||!files)return;
    folder.replaceChildren();
    files.replaceChildren();
    const p=document.createElement('p');
    p.className='text-sm text-center w-full py-10 '+(isError?'text-red-600':'text-gray-500');
    p.textContent=text;
    folder.appendChild(p);
  }
  function paint(){
    if(!searching)return;
    // Legacy infinite-scroll must not run with its stale results array.
    window.isSearching=false;
    window.currentSearchResults=items;
    window.searchDisplayLimit=limit;
    if(!items.length){
      message('Không tìm thấy file hoặc thư mục còn hoạt động trên Drive.');
      return;
    }
    if(typeof window.renderItems==='function')
      window.renderItems(items.slice(0,limit),true);
  }
  function cacheHints(raw){
    const normalized=value=>String(value||'').normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const match=normalized(raw);
    const found=new Set();
    let meta={},folder={},sub={},visible=[];
    try {
      meta=typeof appMeta!=='undefined'?appMeta:(window.appMeta||{});
      folder=typeof folderDataCache!=='undefined'?folderDataCache:(window.folderDataCache||{});
      sub=typeof subFolderCache!=='undefined'?subFolderCache:(window.subFolderCache||{});
      visible=typeof currentDriveItems!=='undefined'?currentDriveItems:(window.currentDriveItems||[]);
    }catch(_){}
    const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
    const consider=(id,name)=>{
      if(found.size>=120||!idOK(id))return;
      if(normalized(name).includes(match)||normalized(meta?.[id]?.name).includes(match))
        found.add(id);
    };
    for(const items of [visible,...Object.values(folder||{}),...Object.values(sub||{})]){
      if(!Array.isArray(items))continue;
      for(const item of items){
        if(item)consider(item.id,item.name);
        if(found.size>=120)break;
      }
      if(found.size>=120)break;
    }
    if(found.size<120){
      for(const [id,value] of Object.entries(meta||{})){
        consider(id,value?.name);
        if(found.size>=120)break;
      }
    }
    return [...found];
  }
  function stop(){
    generation++;
    clearTimeout(timer);
    controller?.abort();
    controller=null;
    searching=false;items=[];limit=30;
    window.isSearching=false;
    window.currentSearchResults=[];
    setClear(false);
    const folderId=(()=>{
      try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
      catch(_){return window.currentFolderId;}
    })();
    let shown;
    try { shown=typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems; }
    catch(_){shown=window.currentDriveItems;}
    if(!Array.isArray(shown)){
      try {shown=typeof folderDataCache!=='undefined'?folderDataCache?.[folderId]:[];}
      catch(_){shown=[];}
    }
    window.renderItems?.(Array.isArray(shown)?shown:[]);
  }
  async function query(raw,id){
    controller?.abort();
    controller=new AbortController();
    message('Đang tìm trong Google Drive…');
    try {
      const response=await fetch('/api/live-library',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'search',keyword:raw,hintIds:cacheHints(raw)}),
        signal:controller.signal
      });
      const data=await response.json().catch(()=>({}));
      if(id!==generation||keyword()!==raw)return;
      if(!response.ok||data.success!==true||!Array.isArray(data.items))
        throw Error(data.message||'Không tìm kiếm được trên Drive');
      items=data.items;
      limit=30;
      paint();
    }catch(error){
      if(id!==generation||error.name==='AbortError'||keyword()!==raw)return;
      items=[];
      message('Không kiểm tra được dữ liệu Drive: '+error.message,true);
    }
  }
  function inputChanged(event){
    if(event.target?.id!==inputId)return;
    // Window capture survives all legacy cloneNode(input) patches and blocks
    // their cached search, including delayed event listeners.
    event.stopImmediatePropagation();
    const raw=keyword();
    if(!raw){stop();return;}
    generation++;
    clearTimeout(timer);
    controller?.abort();
    const id=generation;
    searching=true;
    window.isSearching=false;
    setClear(true);
    timer=setTimeout(()=>void query(raw,id),280);
  }
  window.addEventListener('input',inputChanged,true);
  window.addEventListener('click',event=>{
    if(!event.target?.closest?.('#clearSearchBtn'))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input=byId(inputId);
    if(input){input.value='';input.focus();}
    stop();
  },true);
  // Avoid the legacy scrolling search handler; load 30 more from the
  // verified response whenever the user nears the bottom.
  const content=byId('contentArea');
  content?.addEventListener('scroll',()=>{
    if(!searching||!keyword()||limit>=items.length)return;
    if(content.scrollTop+content.clientHeight>=content.scrollHeight-260){
      limit=Math.min(items.length,limit+30);
      paint();
    }
  },true);
  window.vlLiveSearch={reset:stop,active:()=>searching,results:()=>items.length};
})();