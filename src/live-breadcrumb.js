/* Breadcrumb from the REAL Drive parent chain, including mega-row folders.
   The legacy folderStack intentionally omits some mega levels; do not change
   navigation state just to make those labels visible. */
(() => {
  'use strict';
  if(window.__vlPhysicalBreadcrumbInstalled)return;
  const heading=document.getElementById('currentFolderName');
  if(!heading)return;
  window.__vlPhysicalBreadcrumbInstalled=true;
  heading.classList.remove('truncate');
  heading.classList.add('vl-breadcrumb-scroll');
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
  const paths=new Map();
  let observed=null,inFlight=null,requestSeq=0,drag=null,blockClick=false;
  let lastAttempt=0;

  function folderId(){
    try{return typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){return window.currentFolderId;}
  }
  function category(){
    try{return typeof currentCategory!=='undefined'?currentCategory:'Triển khai';}
    catch(_){return 'Triển khai';}
  }
  function isReady(){
    if(window.vlShareScope)return window.vlShareScope.ready?.()===true;
    return !!localStorage.getItem('vinhloc_authenticated_email');
  }
  function displayPath(path){
    const scope=window.vlShareScope;
    return path.map((entry,i)=>({
      id:entry.id,
      name:(!scope && i===0 && entry.id===ROOT)
        ? category():entry.name
    }));
  }
  function navigate(index,path){
    const item=path[index];
    if(!item||!idOK(item.id)||item.id===folderId())return;
    if(item.id===ROOT&&!window.vlShareScope){
      window.loadFolder?.(ROOT,category(),true,false);
      return;
    }
    // The native navigation stack may omit mega-rows. Restore the correct
    // parent prefix only when the user CLICKED a breadcrumb ancestor, so Back
    // navigates through the same physical levels shown in the header.
    try{
      const stack=typeof folderStack!=='undefined'?folderStack:window.folderStack;
      if(Array.isArray(stack)){
        const ancestors=path.slice(0,index).map(x=>({
          id:x.id,name:x.name,scrollTop:0
        }));
        stack.splice(0,stack.length,...ancestors);
        localStorage.setItem('appFolderStack',JSON.stringify(stack));
      }
    }catch(error){console.warn('[QL Ảnh] Không cập nhật được đường dẫn',error);}
    window.loadFolder?.(item.id,item.name,true,false);
  }
  function render(id,path){
    if(id!==folderId()||!Array.isArray(path)||!path.length)return;
    if(heading.dataset.vlLivePath===id && heading.querySelector('[data-vl-crumb-live]')){
      return;
    }
    const parts=displayPath(path);
    const fragment=document.createDocumentFragment();
    const wrapper=document.createElement('span');
    wrapper.dataset.vlCrumbLive='1';
    wrapper.className='inline-flex items-center whitespace-nowrap gap-1';
    parts.forEach((part,index)=>{
      if(index){
        const sep=document.createElement('span');
        sep.className='opacity-50 px-1 text-[11px] shrink-0';
        sep.textContent='›';
        sep.setAttribute('aria-hidden','true');
        wrapper.appendChild(sep);
      }
      const last=index===parts.length-1;
      const element=document.createElement(last?'span':'button');
      element.textContent=part.name;
      element.className=last?
        'font-bold shrink-0': 'font-normal opacity-75 hover:opacity-100 shrink-0';
      if(!last){
        element.type='button';
        element.title='Mở thư mục '+part.name;
        element.addEventListener('click',event=>{
          if(blockClick){event.preventDefault();return;}
          navigate(index,parts);
        });
      }
      wrapper.appendChild(element);
    });
    fragment.appendChild(wrapper);
    heading.replaceChildren(fragment);
    heading.dataset.vlLivePath=id;
    heading.title=parts.map(x=>x.name).join(' › ');
    heading.scrollLeft=heading.scrollWidth;
  }
  async function update(force=false){
    const id=folderId();
    if(!idOK(id)||!isReady())return;
    if(id===observed&&!force){
      const cached=paths.get(id);
      if(cached?.path){
        render(id,cached.path);
        if(Date.now()-cached.time<60000)return;
      }else if(inFlight===id)return;
    }
    observed=id;
    const cached=paths.get(id);
    if(cached?.path&&!force)render(id,cached.path);
    if(inFlight===id)return;
    const requestId=++requestSeq;
    lastAttempt=Date.now();
    inFlight=id;
    try{
      const response=await fetch('/api/live-library',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'path',folderId:id})
      });
      const data=await response.json().catch(()=>({}));
      if(requestId!==requestSeq||id!==folderId())return;
      if(!response.ok||!data.success||!Array.isArray(data.path)||!data.path.length)return;
      const path=data.path.filter(x=>idOK(x.id)&&typeof x.name==='string');
      if(!path.length||path[path.length-1].id!==id)return;
      paths.set(id,{path,time:Date.now()});
      delete heading.dataset.vlLivePath;
      render(id,path);
    }catch(error){
      console.warn('[QL Ảnh] Không đọc được mega-row trong đường dẫn',error);
    }finally{
      if(inFlight===id)inFlight=null;
    }
  }

  // Mouse/trackpad can click and drag the long breadcrumb; mobile uses
  // native horizontal swipe (touch-action:pan-x, no pointer capture).
  heading.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    drag={x:event.clientX,left:heading.scrollLeft,moved:false};
    heading.classList.add('vl-breadcrumb-dragging');
  });
  window.addEventListener('pointermove',event=>{
    if(!drag)return;
    const delta=event.clientX-drag.x;
    if(Math.abs(delta)>5){
      drag.moved=true;
      heading.scrollLeft=drag.left-delta;
    }
  });
  window.addEventListener('pointerup',()=>{
    if(!drag)return;
    blockClick=drag.moved;
    drag=null;
    heading.classList.remove('vl-breadcrumb-dragging');
    if(blockClick)setTimeout(()=>{blockClick=false;},0);
  });
  heading.addEventListener('click',event=>{
    if(blockClick){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  // Legacy patches may overwrite the heading's content after navigation.
  // Restore the verified full path without initiating a new Drive request.
  new MutationObserver(()=>{
    const id=folderId();
    const cached=paths.get(id);
    if(cached?.path&&heading.dataset.vlLivePath===id&&
       heading.querySelector('[data-vl-crumb-live]'))return;
    if(cached?.path)render(id,cached.path);
  }).observe(heading,{childList:true,subtree:false});
  void update();
  setInterval(()=>{
    const id=folderId();
    if(!idOK(id)||!isReady())return;
    if(observed!==id)void update();
    else if(paths.has(id)&&Date.now()-paths.get(id).time>60000)void update(true);
    else if(!paths.has(id)&&!inFlight&&Date.now()-lastAttempt>8000)void update(true);
  },650);
  window.vlPhysicalBreadcrumb={refresh:()=>update(true)};
})();