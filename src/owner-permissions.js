/* Owner-aware controls for non-admin QL Anh users.
   Server verifies uploadedBy against a signed Google login before deletion.
   Historical items without verified uploader metadata are intentionally locked. */
(() => {
  'use strict';
  const adminEmail='admin@tudonghoavinhloc.com';
  const email=()=>String(localStorage.getItem('vinhloc_authenticated_email')||'').toLowerCase();
  const admin=()=>!window.vlShareScope && email()===adminEmail;
  const current=()=>{try{return Array.isArray(currentDriveItems)?currentDriveItems:window.currentDriveItems||[];}catch(_){return window.currentDriveItems||[];}};
  const idsCache=new Map();
  const pendingIds=new Set();
  let checkedFolder='',lastListSignature='',lastCheckError='',lastChecking=false;
  const TTL=90000;
  function selected(){return window.multiSelectState?.selectedIds||new Set();}
  function can(id){const x=idsCache.get(id);return !!(x&&x.allowed&&Date.now()-x.at<TTL);}
  function typeOf(id){const item=current().find(x=>x.id===id);return item?.type==='folder'?'folder':'file';}
  function nameOf(id){return current().find(x=>x.id===id)?.name||id;}
  function eligible(){return current().filter(x=>can(x.id));}
  function isMedia(item){
    if(!item || item.type==='folder')return false;
    const mime=String(item.mimeType||'').toLowerCase();
    if(mime.startsWith('image/')||mime.startsWith('video/'))return true;
    return /\.(?:jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?|svg|mp4|mov|m4v|avi|mkv|webm|mpeg|mpg|3gp|mts|m2ts)$/i.test(String(item.name||''));
  }
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
    const fresh=items.filter(item=>item.id && !pendingIds.has(item.id) && (force||!idsCache.has(item.id)||Date.now()-idsCache.get(item.id).at>=TTL));
    if(!fresh.length){showHeader();return;}
    fresh.forEach(item=>pendingIds.add(item.id));
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
      }finally{
        ids.forEach(id=>pendingIds.delete(id));
      }
      showHeader();
    }
    lastChecking=pendingIds.size>0;
    showHeader();
    window.vlMenuController?.refreshVisible();
  }
  function renderHeaderBox(){
    if(admin()){
      document.getElementById('vlOwnedControls')?.remove();
      return;
    }
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
      block.addEventListener('click',event=>{
        const target=event.target.closest?.('button[data-vl-owner-action]');
        if(!target || target.disabled)return;
        const action=target.dataset.vlOwnerAction;
        if(!action || action==='none')return;
        event.preventDefault();
        event.stopPropagation();
        if(action==='auth'){
          void window.vlMediaEnsureAuth?.();
        }else if(action==='delete'){
          void menuDelete();
        }else if(action==='all'||action==='folder'||action==='file'||action.startsWith('ext:')){
          choose(action);
        }
      });
      menu.appendChild(block);
    }
    const all=current();
    const owned=eligible();
    const chosen=owned.filter(x=>selected().has(x.id));
    const folders=owned.filter(x=>x.type==='folder');
    const files=owned.filter(isMedia);
    // Use the visible listing, rather than async permission results, to
    // determine which rows exist. Verification only enables the rows.
    const allFiles=all.filter(x=>x.type!=='folder');
    const extension=[...new Set(allFiles.map(x=>String(x.name||'').split('.').pop().toLowerCase()))].filter(Boolean);
    const button=(label,action,disabled=false)=>'<button type="button" data-vl-owner-action="'+action+'" '+
      (disabled?'disabled ':'')+
      'style="display:flex;width:100%;min-height:40px;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;text-align:left;'+
      (disabled?'color:#aaa;':'color:#374151;')+'"><span>'+label+'</span></button>';
    const status=lastCheckError
      ? String(lastCheckError).replace(/[<>&"]/g,'')+' — Nhấn để xác thực lại Google'
      : (lastChecking ? 'Đang xác minh quyền thao tác…' :
        (!owned.length && all.length ? 'Không có quyền sửa/xóa các mục này hoặc thiếu metadata người tải lên.' :
         'Đã kiểm tra quyền cho danh sách đang hiển thị.'));
    const statusAction=lastCheckError?'auth':'none';
    block.innerHTML=
      '<div style="font-size:11px;font-weight:bold;color:#64748b;padding:6px 10px;">DO TÔI TẢI LÊN ('+owned.length+'/'+all.length+')</div>'+
      '<button type="button" data-vl-owner-action="'+statusAction+'" style="display:block;height:48px;overflow:hidden;width:100%;padding:6px 10px;color:#64748b;font-size:12px;line-height:18px;text-align:left;">'+status+'</button>'+
      button('Chọn tất cả file/thư mục của tôi','all',!owned.length)+
      button('Chọn thư mục của tôi ('+folders.length+')','folder',!folders.length)+
      button('Chọn ảnh/video của tôi ('+files.length+')','file',!files.length)+
      extension.map(ext=>button('Chọn file .'+ext+' của tôi','ext:'+ext,!files.some(f=>f.name.toLowerCase().endsWith('.'+ext)))).join('')+
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
      if(which==='file')return isMedia(item);
      if(which.startsWith('ext:'))return item.type!=='folder'&&item.name.toLowerCase().endsWith('.'+which.slice(4));
      return false;
    });
    const set=selected(),allChosen=items.length && items.every(item=>set.has(item.id));
    for(const item of items)if(allChosen)set.delete(item.id);else set.add(item.id);
    if(typeof window.renderItems==='function')window.renderItems(current());
    if(typeof window.buildHeaderMenu==='function')window.buildHeaderMenu();
    showHeader();
  }
  async function menuDelete(){
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
  function refreshMenu(menu){
    if(admin() || !menu?.id?.startsWith('menu-'))return;
    const id=menu.id.slice('menu-'.length);
    // An action slot is present from the very first paint. Permission checks
    // only change disabled state, never insert rows after the menu opens.
    let actions=menu.querySelector('.vl-own-actions');
    if(!actions){
      menu.querySelectorAll('.vl-own-delete,.vl-own-rename,.vl-own-locked').forEach(x=>x.remove());
      actions=document.createElement('div');
      actions.className='vl-own-actions vinhloc-safe-item';
      actions.style.cssText='display:block;width:100%;';
      actions.innerHTML=
        '<button type="button" data-vl-owned="rename" disabled style="display:none;width:100%;min-height:44px;align-items:center;gap:12px;padding:12px 18px;color:#2563eb;font-weight:700;text-align:left;"><i class="fas fa-pen"></i><span>Đổi tên mục của tôi</span></button>'+
        '<button type="button" data-vl-owned="delete" disabled style="display:none;width:100%;min-height:44px;align-items:center;gap:12px;padding:12px 18px;color:#dc2626;font-weight:700;text-align:left;"><i class="fas fa-trash-alt"></i><span>Xóa</span></button>';
      actions.addEventListener('click',async event=>{
        const target=event.target.closest('button[data-vl-owned]');
        if(!target)return;
        event.preventDefault();event.stopImmediatePropagation();
        if(target.disabled || !can(id))return;
        menu.classList.add('hidden');
        if(target.dataset.vlOwned==='delete'){
          window.vlAskOwnedDelete?.(id,typeOf(id));
          return;
        }
        const next=window.prompt('Đổi tên file/thư mục',nameOf(id));
        if(next===null||!next.trim()||next===nameOf(id))return;
        try{
          const result=await api('rename',{id,name:next.trim()});
          const obj=current().find(x=>x.id===id);
          if(obj)obj.name=result.name;
          if(typeof window.renderItems==='function')window.renderItems(current());
          window.showToast?.('Đã đổi tên mục');
        }catch(error){window.showToast?.(error.message,true);}
      },true);
      menu.appendChild(actions);
    }
    const allowed=can(id);
    const rename=actions.querySelector('[data-vl-owned="rename"]');
    const remove=actions.querySelector('[data-vl-owned="delete"]');
    if(rename){
      rename.style.display=window.vlShareScope?.ready()?'flex':'none';
      rename.disabled=!allowed;
      rename.style.opacity=allowed?'1':'0.45';
      rename.title=allowed?'':'Chưa xác minh quyền sở hữu';
    }
    if(remove){
      // Only show Xóa for the verified uploader/creator, for both images
      // and folders. No edit/delete action is shown for another account.
      remove.style.display=allowed?'flex':'none';
      remove.disabled=!allowed;
      remove.title=allowed?'Xóa mục do tài khoản này tải lên hoặc tạo':'';
    }
    if(!idsCache.has(id)||Date.now()-idsCache.get(id).at>=TTL)
      void checkIds([{id}]);
  }
  // Selection is a harmless UI action: permit highlighting any visible
  // file/folder. Ownership restrictions apply only when executing a protected
  // rename/delete operation (enforced again by /api/owned-files).
  function checkPage(){
    if(admin())return;
    const items=current();
    const folder=String(window.currentFolderId||'');
    const signature=folder+'|'+items.length+'|'+items.slice(0,20).map(x=>x.id).join(',');
    if(signature===lastListSignature)return;
    checkedFolder=folder;lastListSignature=signature;
    showHeader();
    void checkIds(items).then(()=>{if(folder===checkedFolder)showHeader()});
  }
  // One synchronous lifecycle handles header and item menus. No delayed
  // click patch or timer may add action rows after the first paint.
  if(window.vlMenuController){
    window.vlMenuController.onItem(({ menu })=>refreshMenu(menu));
    window.vlMenuController.onHeader(()=>renderHeaderBox());
    window.vlMenuController.refreshVisible();
  }else{
    // Graceful fallback if an older cached index lacks menu-controller.js.
    const install=()=>{
      const build=window.buildHeaderMenu;
      if(typeof build==='function'&&!build.__vlOwnerWrapped){
        const wrapped=function(...args){const result=build.apply(this,args);renderHeaderBox();return result;};
        wrapped.__vlOwnerWrapped=true;window.buildHeaderMenu=wrapped;
      }
      const toggle=window.toggleItemMenu;
      if(typeof toggle==='function'&&!toggle.__vlOwnerWrapped){
        const wrapped=function(id,...args){
          const result=toggle.call(this,id,...args);
          const menu=document.getElementById('menu-'+id);
          if(menu && !menu.classList.contains('hidden'))refreshMenu(menu);
          return result;
        };
        wrapped.__vlOwnerWrapped=true;window.toggleItemMenu=wrapped;
      }
    };
    install();
  }
  checkPage();
  setInterval(checkPage,1100);
  const style=document.createElement('style');
  style.textContent='body[data-is-admin="false"] .item-action-menu [onclick*="handleDelete("],'+
    'body[data-is-admin="false"] #headerDropdown [onclick*="deleteSelectedItems("]{display:none!important;}';
  document.head.appendChild(style);
  window.vlOwnerAccess={can,eligible,refresh:async()=>{
    await checkIds(current(),true);
    window.vlMenuController?.refreshVisible();
  }};
})();