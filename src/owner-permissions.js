/* Owner-aware controls for non-admin QL Anh users.
   Server verifies uploadedBy against a signed Google login before deletion.
   Historical items without verified uploader metadata are intentionally locked. */
(() => {
  'use strict';
  const adminEmail='admin@tudonghoavinhloc.com';
  const email=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').toLowerCase();
  const admin=()=>email()===adminEmail;
  const current=()=>{try{return Array.isArray(currentDriveItems)?currentDriveItems:window.currentDriveItems||[];}catch(_){return window.currentDriveItems||[];}};
  const idsCache=new Map();
  let checkedFolder='',lastListSignature='',lastCheckError='',lastChecking=false;
  const TTL=90000;
  function selected(){return window.multiSelectState?.selectedIds||new Set();}
  function can(id){const x=idsCache.get(id);return !!(x&&x.allowed&&Date.now()-x.at<TTL);}
  function typeOf(id){const item=current().find(x=>x.id===id);return item?.type==='folder'?'folder':'file';}
  function nameOf(id){return current().find(x=>x.id===id)?.name||id;}
  function eligible(){return current().filter(x=>can(x.id));}
  function cleanse(){const allowed=new Set(eligible().map(x=>x.id));for(const id of selected())if(!allowed.has(id))selected().delete(id);}
  async function api(action,args={}){
    const response=await fetch('/api/owned-files',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...args}),cache:'no-store'
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success){
      if(response.status===401)void window.vlMediaRequireReauth?.();
      throw Error(data.message||'Không xác nhận được quyền');
    }
    return data;
  }
  function isOpen(){return !!document.querySelector('#headerDropdown:not(.hidden)');}
  async function checkIds(items,force=false){
    if(admin())return;
    const fresh=items.filter(item=>item.id && (force||!idsCache.has(item.id)||Date.now()-idsCache.get(item.id).at>=TTL));
    if(!fresh.length){showHeader();return;}
    lastChecking=true;
    for(let offset=0;offset<fresh.length;offset+=50){
      const ids=fresh.slice(offset,offset+50).map(item=>item.id);
      try{
        const response=await api('check',{ids});
        lastCheckError='';
        for(const id of ids){
          const info=response.items?.[id];
          idsCache.set(id,{allowed:!!info?.allowed,at:Date.now()});
        }
      }catch(e){
        lastCheckError=e.message || 'Chưa xác minh được quyền xóa';
        console.warn('[QL Ảnh] Kiểm tra người upload',e);
        // Do not grant delete permission when unable to verify.
        for(const id of ids)idsCache.set(id,{allowed:false,at:Date.now()-TTL+10000});
      }
      showHeader();
    }
    lastChecking=false;
    showHeader();
  }
  function renderHeaderBox(){
    if(admin())return;
    const menu=document.getElementById('headerDropdown');
    if(!menu)return;
    menu.style.maxHeight='min(70vh, 520px)';
    menu.style.overflowY='auto';
    menu.style.width='min(320px, calc(100vw - 24px))';
    let block=document.getElementById('vlOwnedControls');
    if(!block){
      block=document.createElement('div');
      block.id='vlOwnedControls';
      block.className='vinhloc-safe-item';
      block.style.cssText='display:block!important;position:relative!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;width:100%!important;padding:8px!important;margin:0!important;';
      menu.appendChild(block);
    }
    const owned=eligible();
    const filtered=selected();
    const chosen=owned.filter(x=>filtered.has(x.id));
    const folders=owned.filter(x=>x.type==='folder');
    const files=owned.filter(x=>x.type!=='folder');
    const extension=[...new Set(files.map(x=>String(x.name||'').split('.').pop().toLowerCase()))].filter(Boolean);
    const button=(label,action,disabled=false)=>'<button type="button" data-vl-owner-action="'+action+'" '+
      (disabled?'disabled ':'')+
      'style="display:flex;width:100%;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;text-align:left;'+
      (disabled?'color:#aaa;':'color:#374151;')+'"><span>'+label+'</span></button>';
    const rightsMessage=lastCheckError
      ? '<div style="padding:8px;color:#b45309;font-size:12px;">'+String(lastCheckError).replace(/[<>&"]/g,'')+' — Đăng nhập lại Google để kiểm tra quyền.</div>'+button('Xác thực tài khoản Google','auth')
      : (lastChecking ? '<div style="padding:8px;color:#64748b;font-size:12px;">Đang xác minh người tải lên…</div>' :
        (!owned.length && current().length ? '<div style="padding:8px;color:#64748b;font-size:12px;">Không có mục nào có thông tin người tải lên được xác minh cho tài khoản này. File cũ chưa gắn metadata cần admin xác nhận.</div>' : ''));
    block.innerHTML=
      '<div style="font-size:11px;font-weight:bold;color:#64748b;padding:6px 10px;">DO TÔI TẢI LÊN ('+owned.length+'/'+current().length+')</div>'+rightsMessage+
      button('Chọn tất cả file/thư mục của tôi','all',!owned.length)+
      button('Chọn thư mục của tôi ('+folders.length+')','folder',!folders.length)+
      button('Chọn ảnh/video của tôi ('+files.length+')','file',!files.length)+
      extension.map(ext=>button('Chọn file .'+ext+' của tôi','ext:'+ext)).join('')+
      button('Đang chọn: '+chosen.length+' mục','none',true)+
      button('Xóa '+chosen.length+' mục đã chọn của tôi','delete',!chosen.length);
  }
  function showHeader(){
    if(!isOpen()||admin())return;
    renderHeaderBox();
  }
  function choose(which){
    const items=eligible().filter(item=>{
      if(which==='all')return true;
      if(which==='folder')return item.type==='folder';
      if(which==='file')return item.type!=='folder';
      if(which.startsWith('ext:'))return item.type!=='folder'&&item.name.toLowerCase().endsWith('.'+which.slice(4));
      return false;
    });
    const set=selected(),allChosen=items.length && items.every(item=>set.has(item.id));
    for(const item of items)if(allChosen)set.delete(item.id);else set.add(item.id);
    cleanse();
    if(typeof window.renderItems==='function')window.renderItems(current());
    if(typeof window.buildHeaderMenu==='function')window.buildHeaderMenu();
    showHeader();
  }
  async function menuDelete(){
    cleanse();
    const candidates=eligible().filter(x=>selected().has(x.id));
    if(!candidates.length)return;
    // The existing delete-consistency modal reads selectedIds; its backend
    // now uses /api/owned-files for every non-admin item.
    if(typeof window.vlAskOwnedBatch==='function'){
      window.vlAskOwnedBatch(candidates.map(x=>({id:x.id,type:typeOf(x.id)})));
    }else{
      alert('Chưa tải xong chức năng xóa có xác thực.');
    }
  }
  async function refreshMenu(menu){
    const id=menu.id.slice('menu-'.length);
    let existing=menu.querySelector('.vl-own-delete');
    if(existing)existing.remove();
    await checkIds([{id}]);
    if(menu.classList.contains('hidden'))return;
    if(!can(id)) {
      if(menu.querySelector('.vl-own-locked'))return;
      const hint=document.createElement('div');
      hint.className='vl-own-locked vinhloc-safe-item';
      hint.style.cssText='display:block!important;padding:10px 12px;color:#64748b;font:12px system-ui;';
      hint.textContent=lastCheckError?'Chưa xác minh Google để xóa':'Không có quyền xóa: chưa xác minh người tải lên';
      menu.appendChild(hint);
      return;
    }
    menu.querySelector('.vl-own-locked')?.remove();
    const button=document.createElement('button');
    button.type='button';
    button.className='vl-own-delete vinhloc-safe-item';
    button.style.cssText='display:flex!important;position:relative!important;visibility:visible!important;opacity:1!important;width:100%!important;padding:12px 18px!important;gap:12px!important;color:#dc2626!important;font-weight:700!important;text-align:left!important;';
    const icon=document.createElement('i');icon.className='fas fa-trash-alt';
    const label=document.createElement('span');label.textContent='Xóa mục tôi đã tải lên';
    button.append(icon,label);
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      if(!can(id))return;
      menu.classList.add('hidden');
      window.vlAskOwnedDelete?.(id,typeOf(id));
    },true);
    menu.appendChild(button);
  }
  // Apply the ownership constraint to the shared selection Set as well:
  // long-press and checkbox selections must not silently select another
  // account's file, even when the legacy toolbar is hidden by CSS.
  let guardedSet = null;
  function guardSelection(){
    if(admin())return;
    const set=selected();
    if(set===guardedSet || !(set instanceof Set))return;
    const add=Set.prototype.add;
    set.add=function(id){
      if(!can(id))return this;
      return add.call(this,id);
    };
    guardedSet=set;
    cleanse();
  }
  function checkPage(){
    if(admin())return;
    guardSelection();
    const items=current();
    const folder=String(window.currentFolderId||'');
    const signature=folder+'|'+items.length+'|'+items.slice(0,20).map(x=>x.id).join(',');
    if(signature===lastListSignature)return;
    checkedFolder=folder;lastListSignature=signature;
    showHeader();
    void checkIds(items).then(()=>{if(folder===checkedFolder)showHeader()});
  }
  // Existing scripts override these functions several seconds after load,
  // and their legacy buildHeaderMenu() clears innerHTML each time.
  // Attach to the function itself instead of hoping a delayed click handler
  // runs after the last DOM rewrite.
  let wrappedHeader=null, wrappedToggle=null;
  function installMenuHooks(){
    if(admin())return;
    const build=window.buildHeaderMenu;
    if(typeof build==='function' && build!==wrappedHeader && !build.__vlOwnerWrapped) {
      const proxy=function(...args) {
        const result=build.apply(this,args);
        renderHeaderBox(); // even if it is currently hidden
        return result;
      };
      proxy.__vlOwnerWrapped=true;
      window.buildHeaderMenu=wrappedHeader=proxy;
    }
    const toggle=window.toggleItemMenu;
    if(typeof toggle==='function' && toggle!==wrappedToggle && !toggle.__vlOwnerWrapped) {
      const proxy=function(id,event) {
        const result=toggle.apply(this,arguments);
        const menu=document.getElementById('menu-'+id);
        if(menu && !menu.classList.contains('hidden'))void refreshMenu(menu);
        return result;
      };
      proxy.__vlOwnerWrapped=true;
      window.toggleItemMenu=wrappedToggle=proxy;
    }
    if(document.getElementById('headerDropdown') &&
       !document.getElementById('vlOwnedControls'))renderHeaderBox();
  }
  installMenuHooks();
  setInterval(installMenuHooks,900);
  document.addEventListener('click',event=>{
    if(admin())return;
    const btn=event.target.closest?.('[data-vl-owner-action]');
    if(btn){
      event.preventDefault();event.stopImmediatePropagation();
      const action=btn.dataset.vlOwnerAction;
      if(action==='delete')void menuDelete();
      else if(action==='auth')window.vlMediaRequireReauth?.();
      else if(action!=='none')choose(action);
      return;
    }
    // Legacy app shows its three-dot menus from inline handlers. Inspect
    // after that handler has finished, without replacing its admin logic.
    setTimeout(()=>{
      if(admin())return;
      for(const menu of document.querySelectorAll('.item-action-menu:not(.hidden)[id^="menu-"]'))
        void refreshMenu(menu);
      if(isOpen()){showHeader();void checkIds(current());}
    },10);
  },true);
  const style=document.createElement('style');
  style.textContent='body[data-is-admin="false"] .item-action-menu [onclick*="handleDelete("],'+
    'body[data-is-admin="false"] #headerDropdown [onclick*="deleteSelectedItems("]{display:none!important;}';
  document.head.appendChild(style);
  setInterval(checkPage,1100);
  window.vlOwnerAccess={can,eligible,refresh:()=>checkIds(current(),true)};
})();