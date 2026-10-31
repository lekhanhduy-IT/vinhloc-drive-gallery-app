/* QL Anh: verified deletion + protection against stale spider/global cache.
   Never let a display-only "deleted" state masquerade as a Drive deletion. */
(() => {
  'use strict';
  if (window.__vlDeletionConsistencyInstalled) return;
  window.__vlDeletionConsistencyInstalled = true;
  const KEY = 'vinhloc_verified_deleted_ids_v2';
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const SCRIPT_DEFAULT = 'https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';
  const ID_PATTERN = /^[A-Za-z0-9_-]{10,180}$/;
  let confirmed = {};
  let activeDialog = null;
  let deleting = false;
  let latestWrapper = null;
  function globals(name) {
    try {
      switch(name) {
        case 'folder': return typeof currentFolderId !== 'undefined' ? currentFolderId : window.currentFolderId;
        case 'items': return typeof currentDriveItems !== 'undefined' ? currentDriveItems : window.currentDriveItems;
        case 'cache': return typeof folderDataCache !== 'undefined' ? folderDataCache : window.folderDataCache;
        case 'sub': return typeof subFolderCache !== 'undefined' ? subFolderCache : window.subFolderCache;
        case 'meta': return typeof appMeta !== 'undefined' ? appMeta : window.appMeta;
        case 'endpoint': return typeof SCRIPT_URL !== 'undefined' ? SCRIPT_URL : SCRIPT_DEFAULT;
      }
    } catch(_) {return null;}
  }
  function toast(text, error=false) {
    if (typeof window.showToast === 'function') window.showToast(text, error);
    else console[error?'error':'info']('[QL Ảnh]', text);
  }
  function loadMarkers() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) confirmed = stored;
    } catch(_) {}
    cleanMarkers();
  }
  function cleanMarkers() {
    const now = Date.now();
    for(const id of Object.keys(confirmed)) {
      if(!ID_PATTERN.test(id) || !Number.isFinite(Number(confirmed[id])) ||
         Number(confirmed[id]) < now - TTL || Number(confirmed[id]) > now + 60000)
        delete confirmed[id];
    }
    try {localStorage.setItem(KEY, JSON.stringify(confirmed));} catch(_) {}
  }
  function isDeleted(id) {
    return !!(id && confirmed[id] && Date.now()-Number(confirmed[id]) < TTL);
  }
  function safe(items) {
    return Array.isArray(items) ? items.filter(item=>!isDeleted(item?.id)) : items;
  }
  function installRenderGuard() {
    const fn = window.renderItems;
    if(typeof fn!=='function' || fn===latestWrapper || fn.__vlDeletedGuard) return;
    const guard = function(items,...args) {
      return fn.call(this,safe(items),...args);
    };
    guard.__vlDeletedGuard = true;
    latestWrapper=guard;
    window.renderItems=guard;
  }
  function removeFromCaches(id) {
    const cache=globals('cache');
    const sub=globals('sub');
    if(cache && typeof cache==='object') {
      for(const key of Object.keys(cache)) {
        if(key===id) {delete cache[key];continue;}
        if(Array.isArray(cache[key])) cache[key]=cache[key].filter(item=>item.id!==id);
      }
    }
    if(sub && typeof sub==='object') {
      for(const key of Object.keys(sub)) {
        if(key===id) {delete sub[key];continue;}
        if(Array.isArray(sub[key])) sub[key]=sub[key].filter(item=>item.id!==id);
      }
    }
    const items=globals('items');
    if(Array.isArray(items)) {
      const updated=items.filter(item=>item.id!==id);
      try {currentDriveItems=updated;} catch(_) {window.currentDriveItems=updated;}
    }
    const meta=globals('meta');
    if(meta && Object.prototype.hasOwnProperty.call(meta,id)) delete meta[id];
  }
  async function persist() {
    if(!window.localforage) return;
    const jobs=[
      localforage.setItem('vinhloc_folder_cache',globals('cache') || {}),
      localforage.setItem('vinhloc_subfolder_cache',globals('sub') || {}),
      localforage.setItem('vinhloc_meta',globals('meta') || {})
    ];
    const result=await Promise.allSettled(jobs);
    if(result.some(x=>x.status==='rejected')) console.warn('[QL Ảnh] Chưa lưu đủ cache sau khi xóa');
    try {
      const queue=await localforage.getItem('vinhloc_action_queue');
      if(Array.isArray(queue)) {
        const filtered=queue.filter(task=>!(task.action==='delete' && isDeleted(task.payload?.id)));
        if(filtered.length!==queue.length) await localforage.setItem('vinhloc_action_queue',filtered);
      }
    } catch(_) {}
  }
  async function api(action, params) {
    const response=await fetch(globals('endpoint') || SCRIPT_DEFAULT,{
      method:'POST',body:JSON.stringify({action,...params}),cache:'no-store'
    });
    if(!response.ok) throw new Error('Lỗi kết nối Drive (HTTP '+response.status+')');
    let result;
    try { result=await response.json(); } catch(_) { throw new Error('Máy chủ không trả JSON'); }
    if(result?.success !== true)
      throw new Error(result?.message || result?.error || 'Drive chưa xác nhận thao tác');
    return result;
  }
  function parentFor(id) {
    const cache=globals('cache'), sub=globals('sub');
    for(const dataset of [cache,sub]) {
      if(!dataset || typeof dataset!=='object') continue;
      for(const [parentId, items] of Object.entries(dataset)) {
        if(Array.isArray(items) && items.some(item=>item.id===id)) return parentId;
      }
    }
    return globals('folder');
  }
  function kindFor(id) {
    const datasets=[globals('items'),...Object.values(globals('cache')||{}),...Object.values(globals('sub')||{})];
    for(const list of datasets) {
      if(!Array.isArray(list)) continue;
      const found=list.find(item=>item?.id===id);
      if(found?.type) return found.type;
    }
    return 'file';
  }
  function removeLegacyBlacklist() {
    // Legacy 5-minute NAME-based blacklist may delete unrelated duplicate names.
    // This extension uses confirmed immutable Drive IDs only.
    try{localStorage.removeItem('vinhloc_blacklist');}catch(_){}
  }
  async function deleteVerified({id,type,parentId}) {
    if(!ID_PATTERN.test(id) || id.startsWith('temp_'))
      throw new Error('Mục chưa có ID thật; hãy đợi tạo xong trước khi xóa');
    const parent=parentId || parentFor(id);
    await api('delete',{id,type:type==='folder'?'folder':'file'});
    // The backend setTrashed(true) returned success. Verify the item is now
    // absent from its previous Drive parent before purging the local cache.
    if(parent && ID_PATTERN.test(parent)) {
      let list=null;
      let lastError=null;
      for(let attempt=0;attempt<2;attempt++) {
        try {
          const result=await api('list',{folderId:parent});
          if(!Array.isArray(result.data)) throw new Error('Không có danh sách xác minh');
          list=result.data;
          if(!list.some(item=>item.id===id)) break;
        } catch(e) {lastError=e;}
        await new Promise(resolve=>setTimeout(resolve,550));
      }
      if(!list) {
        // Delete succeeded but listing is unavailable. This is not a failure
        // of delete; mark verified via server response and resync later.
        console.warn('[QL Ảnh] Chưa đọc lại được thư mục sau xóa',lastError);
      } else if(list.some(item=>item.id===id)) {
        throw new Error('Drive vẫn trả mục này sau lệnh xóa. Chưa cập nhật giao diện.');
      } else if(typeof window.__vinhlocRecordDriveList==='function') {
        window.__vinhlocRecordDriveList(list,parent);
      }
    }
    confirmed[id]=Date.now();
    cleanMarkers();
    removeFromCaches(id);
    await persist();
    installRenderGuard();
    if(typeof window.renderItems==='function' && Array.isArray(globals('items')))
      window.renderItems(globals('items'));
    window.vinhloc_cache_modified=true;
  }
  function closeDialog() {
    const modal=document.getElementById('customModal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
  }
  function confirmDialog(items) {
    if(deleting) return;
    const modal=document.getElementById('customModal');
    const title=document.getElementById('modalTitle');
    const desc=document.getElementById('modalDesc');
    const input=document.getElementById('modalInput');
    const confirm=document.getElementById('modalConfirmBtn');
    if(!modal||!title||!desc||!confirm) return;
    activeDialog={items, title:items.length===1?'Xác nhận xóa mục':'Xác nhận xóa '+items.length+' mục'};
    title.textContent=activeDialog.title;
    desc.textContent='Chỉ xóa khỏi danh sách sau khi Google Drive xác nhận. Không thể hoàn tác trong QL Ảnh.';
    desc.classList.remove('hidden');
    input?.classList.add('hidden');
    confirm.textContent=items.length===1?'Xóa':'Xóa tất cả';
    confirm.className='px-5 py-2 bg-red-600 text-white font-bold rounded-xl';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  async function execute(items) {
    deleting=true;
    const total=items.length, failed=[], passed=[];
    toast('Đang xác nhận xóa '+total+' mục với Google Drive...');
    try {
      for(const item of items) {
        try {
          await deleteVerified(item);
          passed.push(item.id);
        } catch(e) {
          failed.push({id:item.id,reason:e.message});
          console.warn('[QL Ảnh] Xóa không thành công',item.id,e);
        }
      }
      const selected=window.multiSelectState?.selectedIds;
      if(selected && typeof selected.delete==='function')
        for(const id of passed) selected.delete(id);
      if(typeof window.buildHeaderMenu==='function') window.buildHeaderMenu();
      if(failed.length)
        toast('Đã xóa '+passed.length+'/'+total+'. '+failed.length+' mục còn trên Drive. '+failed[0].reason,true);
      else toast('Drive xác nhận đã xóa '+passed.length+'/'+total+' mục.');
      // After server confirmation, schedule a genuine fresh read. Never
      // replace cache with stale crawler data as a substitute for verification.
      if(typeof window.vinhlocLiveDriveSync==='function')
        void window.vinhlocLiveDriveSync().catch(err=>console.warn('[QL Ảnh] Đồng bộ sau xóa',err));
    } finally{deleting=false;}
  }
  function parseClickCode(code) {
    const m=code.match(/(?:window\.)?handleDelete\(\s*['"]([A-Za-z0-9_-]+)['"]\s*,\s*['"](folder|file)['"]/);
    return m?{id:m[1],type:m[2],parentId:parentFor(m[1])}:null;
  }
  function interceptClick(event) {
    const el=event.target?.closest?.('[onclick]');
    const code=el?.getAttribute('onclick')||'';
    if(code.includes('handleDelete(')) {
      const item=parseClickCode(code);
      if(!item) return;
      event.preventDefault();event.stopImmediatePropagation();
      document.querySelectorAll('.item-action-menu').forEach(x=>x.classList.add('hidden'));
      confirmDialog([item]);
      return;
    }
    if(code.includes('deleteSelectedItems(')) {
      const ids=window.multiSelectState?.selectedIds;
      if(!ids?.size) return;
      event.preventDefault();event.stopImmediatePropagation();
      const entries=Array.from(ids).map(id=>({id,type:kindFor(id),parentId:parentFor(id)}));
      confirmDialog(entries);
      return;
    }
    const confirm=document.getElementById('modalConfirmBtn');
    if(confirm && (event.target===confirm || confirm.contains(event.target)) && activeDialog) {
      const title=document.getElementById('modalTitle');
      const modal=document.getElementById('customModal');
      if(title?.textContent!==activeDialog.title || modal?.classList.contains('hidden')) {
        activeDialog=null;
        return;
      }
      event.preventDefault();event.stopImmediatePropagation();
      if(deleting) return;
      const items=activeDialog.items;
      activeDialog=null;
      closeDialog();
      void execute(items);
      return;
    }
    const modal=document.getElementById('customModal');
    if(activeDialog && modal && modal.contains(event.target) &&
       (event.target?.closest?.('[onclick*="closeModal("]') ||
        event.target?.textContent?.trim()==='Hủy')) {
      activeDialog=null;
    }
  }
  loadMarkers();
  removeLegacyBlacklist();
  document.addEventListener('click',interceptClick,true);
  installRenderGuard();
  setInterval(installRenderGuard,1400);
  window.vlVerifiedDeletions={isDeleted, safe, count:()=>Object.keys(confirmed).length};
})();