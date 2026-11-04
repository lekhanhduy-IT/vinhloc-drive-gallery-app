/* Member create-folder controls, independent of legacy admin-only menu patches.
   Membership comes from a verified /api session or the verified share scope. */
(() => {
  'use strict';
  if(window.__vlMemberCreateControls)return;
  window.__vlMemberCreateControls=true;
  const ROOT='1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,180}$/.test(id);
  const button=()=>document.querySelector('#fabMenu button[onclick*="uiPromptFolder"]');
  let internal=false,checking=null,lastCheck=0,dialog=null,creating=false;

  function scope(){
    return window.vlShareScope||null;
  }
  function localAdmin(){
    return !scope()&&String(localStorage.getItem('vinhloc_authenticated_email')||'').toLowerCase()==='admin@tudonghoavinhloc.com';
  }
  function member(){
    const shared=scope();
    return shared ? shared.ready?.()===true&&shared.member?.()===true : internal;
  }
  function currentFolder(){
    let id;
    try {id=typeof currentFolderId!=='undefined'?currentFolderId:window.currentFolderId;}
    catch(_){id=window.currentFolderId;}
    const shared=scope();
    if(shared && (!idOK(id)||id===ROOT))return shared.root;
    return id;
  }
  function category(){
    try{return (typeof currentCategory!=='undefined'?currentCategory:window.currentCategory)==='Ý tưởng'?'Ý tưởng':'Triển khai';}
    catch(_){return 'Triển khai';}
  }
  function setDisplay(){
    const allowed=member();
    document.body.dataset.vlAuthorizedMemberCreate=allowed?'true':'false';
    const el=button();
    if(!el)return;
    // Inline !important beats the legacy Patch-60 anti-mega-row CSS.
    if(allowed && !localAdmin()){
      el.style.setProperty('display','flex','important');
      el.dataset.vlMemberCreate='true';
      el.querySelector('.fab-action-name')?.replaceChildren(document.createTextNode('Thêm thư mục'));
    }else {
      el.style.removeProperty('display');
      delete el.dataset.vlMemberCreate;
    }
  }
  async function verifyMember(force=false){
    if(scope()){setDisplay();return member();}
    if(!localStorage.getItem('vinhloc_authenticated_email')){
      internal=false;setDisplay();return false;
    }
    if(internal && !force){setDisplay();return true;}
    if(checking)return checking;
    if(!force && Date.now()-lastCheck<1300)return false;
    lastCheck=Date.now();
    checking=(async()=>{
      try{
        const result=await fetch('/api/owned-files',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'status'})
        });
        if(!result.ok)return false;
        const data=await result.json();
        // Never elevate a share-only session to a global-root creator.
        internal=data.success===true&&data.isMember===true&&!data.scopeRoot;
        return internal;
      }catch(error){
        console.warn('[QL Ảnh] Chưa xác minh được thành viên nội bộ',error);
        return false;
      }finally{
        checking=null;
        setDisplay();
      }
    })();
    return checking;
  }
  function toast(message,error=false){
    if(typeof window.showToast==='function')window.showToast(message,error);
    else if(error)console.warn('[QL Ảnh]',message);
  }
  function state(name){
    try{
      if(name==='cache')return typeof folderDataCache!=='undefined'?folderDataCache:window.folderDataCache;
      if(name==='sub')return typeof subFolderCache!=='undefined'?subFolderCache:window.subFolderCache;
      if(name==='meta')return typeof appMeta!=='undefined'?appMeta:window.appMeta;
      if(name==='items')return typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems;
    }catch(_){}
    return null;
  }
  function afterCreate(parent,item,isMegaRow){
    const meta=state('meta');
    if(meta){
      meta[item.id]={...(meta[item.id]||{}),name:item.name,
        type:category(),desc:meta[item.id]?.desc||'',cover:meta[item.id]?.cover||''};
      if(window.localforage)void localforage.setItem('vinhloc_meta',meta).catch(()=>{});
    }
    const cache=state('cache'),sub=state('sub');
    const active=currentFolder();
    const current=state('items');
    const initial=parent===active && Array.isArray(current)?current:
      (Array.isArray(cache?.[parent])?cache[parent]:[]);
    const list=[...initial.filter(it=>it.id!==item.id),item].sort((a,b)=>
      a.type===b.type?String(a.name||'').localeCompare(String(b.name||''),'vi'):
        a.type==='folder'?-1:1);
    if(cache){
      cache[parent]=list;
      if(window.localforage)void localforage.setItem('vinhloc_folder_cache',cache).catch(()=>{});
    }
    if(sub && Array.isArray(sub[parent])){
      sub[parent]=list.filter(it=>it.type==='folder');
      if(window.localforage)void localforage.setItem('vinhloc_subfolder_cache',sub).catch(()=>{});
    }
    if(parent===active){
      try{currentDriveItems=list;}catch(_){window.currentDriveItems=list;}
      window.renderItems?.(list);
    }else if(sub?.[parent]&&typeof window.renderSubFolders==='function'){
      window.renderSubFolders(parent,sub[parent]);
    }
    if(isMegaRow && meta?.[item.id] && typeof window.smoothUpdateUI==='function')
      window.smoothUpdateUI({[item.id]:meta[item.id]});
  }
  async function create(parent,name,commitButton,input){
    if(creating)return;
    creating=true;
    commitButton.disabled=true;
    const old=commitButton.textContent;
    commitButton.textContent='Đang tạo…';
    try{
      if(!member())throw Error('Chưa xác minh thành viên thuộc kho Drive dùng chung');
      if(!idOK(parent)||!name||name.length>180)throw Error('Tên hoặc thư mục cha không hợp lệ');
      const response=await fetch('/api/owned-files',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'createFolder',folderId:parent,name,
          isMegaRow:!scope()&&parent===ROOT,category:category()})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.success||!idOK(result.id))
        throw Error(result.message||'Google Drive chưa xác nhận tạo thư mục');
      const item={id:result.id,name:result.name||name,type:'folder',
        uploadedBy:result.uploaderEmail||''};
      afterCreate(parent,item,!!result.isMegaRow);
      closeDialog();
      if(result.warning)toast(result.warning,true);
      else toast('Đã tạo thư mục "'+item.name+'" trên Drive.');
    }catch(error){
      toast('Không thể tạo thư mục: '+error.message,true);
      if(dialog)input.focus();
    }finally{
      creating=false;
      commitButton.disabled=false;
      commitButton.textContent=old;
    }
  }
  function closeDialog(){
    dialog?.remove();dialog=null;
  }
  function openCreateDialog(){
    if(dialog||!member())return;
    const parent=currentFolder();
    if(!idOK(parent)){toast('Chưa xác định được thư mục đang mở.',true);return;}
    const isMegaRow=!scope()&&parent===ROOT;
    const el=document.createElement('section');
    el.id='vlMemberCreateDialog';
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
    el.style.cssText='position:fixed;inset:0;z-index:10060;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;';
    const box=document.createElement('div');
    box.style.cssText='background:white;border-radius:18px;width:100%;max-width:420px;padding:22px;box-shadow:0 20px 55px #0003;font:14px system-ui;color:#1f2937;';
    const title=document.createElement('h2');
    title.textContent=isMegaRow?'Tạo thư mục mega-row':'Tạo thư mục mới';
    title.style.cssText='font-size:20px;font-weight:750;color:#2563eb;margin:0 0 10px;';
    title.id='vlMemberCreateTitle';
    el.setAttribute('aria-labelledby',title.id);
    const hint=document.createElement('p');
    hint.textContent=isMegaRow?
      'Tạo thư mục cấp gốc trong danh mục '+category()+'.':
      'Thư mục mới sẽ nằm trong thư mục đang xem.';
    hint.style.cssText='font-size:13px;color:#64748b;margin:0 0 16px;';
    const input=document.createElement('input');
    input.type='text';input.maxLength=180;input.placeholder='Tên thư mục';
    input.style.cssText='width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:13px 12px;font:600 14px system-ui;outline:none;';
    const error=document.createElement('p');
    error.style.cssText='font-size:12px;color:#dc2626;min-height:18px;margin:6px 0;';
    const actions=document.createElement('div');
    actions.style.cssText='display:flex;gap:10px;justify-content:flex-end;margin-top:18px;';
    const cancel=document.createElement('button');
    cancel.type='button';cancel.textContent='Hủy';
    cancel.style.cssText='border:1px solid #cbd5e1;border-radius:10px;padding:11px 16px;background:white;font-weight:650;';
    cancel.addEventListener('click',()=>{if(!creating)closeDialog();});
    const save=document.createElement('button');
    save.type='button';save.textContent='Tạo thư mục';
    save.style.cssText='border:0;border-radius:10px;padding:11px 18px;background:#2563eb;color:white;font-weight:750;';
    const submit=()=>{
      if(creating)return;
      const name=input.value.trim();
      if(!name){error.textContent='Vui lòng nhập tên thư mục.';input.focus();return;}
      error.textContent='';
      void create(parent,name,save,input);
    };
    save.addEventListener('click',submit);
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();submit();}
      if(e.key==='Escape'&&!creating)closeDialog();
    });
    cancel.addEventListener('keydown',e=>{if(e.key==='Escape'&&!creating)closeDialog();});
    actions.append(cancel,save);box.append(title,hint,input,error,actions);
    el.appendChild(box);document.body.appendChild(el);dialog=el;
    input.focus();
    const menu=document.getElementById('fabMenu');
    menu?.classList.add('hidden');
    menu?.classList.remove('flex');
  }
  // Consume this action before old Patch-60 replaces uiPromptFolder() with
  // a hard-coded admin-only alert, and before old fake-ID queued creation.
  document.addEventListener('click',event=>{
    const action=event.target.closest?.('#fabMenu button[onclick*="uiPromptFolder"]');
    if(!action)return;
    if(!member()){
      if(scope() && scope().ready?.() && !scope().member?.())return;
      // Don't let the old admin-only handler display a false permission error
      // while this account is still finishing its verified media login.
      event.preventDefault();
      event.stopImmediatePropagation();
      void verifyMember(true);
      toast('Đang xác minh quyền tạo thư mục…');
      return;
    }
    if(localAdmin()&&!scope())return; // Keep the normal admin flow intact.
    event.preventDefault();
    event.stopImmediatePropagation();
    openCreateDialog();
  },true);

  const authOverlay=document.getElementById('auth-overlay');
  if(authOverlay&&window.MutationObserver){
    new MutationObserver(()=>{
      if(authOverlay.classList.contains('hidden')||authOverlay.style.display==='none')
        void verifyMember(true);
    }).observe(authOverlay,{attributes:true,attributeFilter:['class','style']});
  }
  window.addEventListener('vl:share-member-ready',setDisplay);
  window.addEventListener('vl:media-authorized',()=>void verifyMember(true));
  window.addEventListener('focus',()=>void verifyMember());
  window.addEventListener('pageshow',()=>void verifyMember());
  document.getElementById('fabMain')?.addEventListener('click',()=>{
    void verifyMember();
    setDisplay();
  });
  void verifyMember();
  setDisplay();
})();
