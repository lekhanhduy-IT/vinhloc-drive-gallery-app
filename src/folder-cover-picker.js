/* Use an existing photo as a folder cover without uploading a duplicate.
   The original info Save button persists appMeta.cover via updateSingleMeta. */
(() => {
  'use strict';
  if (window.__vlFolderCoverPicker) return;
  window.__vlFolderCoverPicker = true;

  const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,180}$/.test(value);
  const byId = id => document.getElementById(id);
  const picker = byId('infoFolderImagePicker');
  const grid = byId('infoFolderImageGrid');
  const status = byId('infoFolderImageStatus');
  const more = byId('infoFolderImageMore');
  const search = byId('infoFolderImageSearch');
  const confirm = byId('infoFolderImageConfirm');
  const selectedLabel = byId('infoFolderImageSelected');
  if (!picker || !grid || !confirm) return;

  let edit = null;
  let cover = null;  // confirmed in the picker, but not yet saved
  let focused = null;
  let choice = null; // selected in the grid, but not yet confirmed
  let images = [];
  let page = '';
  let loading = false;
  let generation = 0;

  const imageURL = id => '/api/media?fileId=' + encodeURIComponent(id) + '&variant=thumb';

  // Drive appProperties are the authority for images chosen from the folder.
  // The old obfuscated app reassigns its private appMeta object after startup,
  // so writing window.appMeta does NOT reliably update its actual data model.
  const driveCovers = new Map();
  const inFlight = new Set();
  const CACHE_TTL = 25000;
  let scanTimer = null;
  let saveBusy = false;
  let replayLegacySave = false;

  function applyFolderCover(id, imageId) {
    if (!idOk(id) || !idOk(imageId)) return;
    const src = imageURL(imageId);
    document.querySelectorAll('.item-cover-img-' + id).forEach(img => {
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.classList.remove('hidden');
    });
    document.querySelectorAll('.item-cover-icon-' + id).forEach(icon => icon.classList.add('hidden'));
  }
  function applyDialogCover(id, imageId) {
    if (edit?.id !== id || !idOk(imageId) || cover) return;
    const modal = byId('infoModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const preview = byId('infoCoverPreview');
    if (!preview) return;
    preview.src = imageURL(imageId);
    preview.classList.remove('hidden');
    byId('infoCoverPlaceholder')?.classList.add('hidden');
  }
  function repaintKnown() {
    for (const [id,record] of driveCovers) {
      if (!record.imageId) continue;
      applyFolderCover(id,record.imageId);
    }
  }
  async function loadSavedCovers(ids, force = false) {
    const now = Date.now();
    const fresh = [...new Set(ids)].filter(id =>
      idOk(id) && !inFlight.has(id) &&
      (force || !driveCovers.has(id) || now-driveCovers.get(id).time>CACHE_TTL));
    if (!fresh.length) return;
    // Avoid expensive Drive GET calls for every folder every time JS renders.
    for (let start=0;start<fresh.length;start+=80) {
      const group=fresh.slice(start,start+80);
      const requestedAt=Date.now();
      group.forEach(id=>inFlight.add(id));
      try {
        const res=await fetch('/api/folder-cover',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'get',folderIds:group}),cache:'no-store'
        });
        const data=await res.json().catch(()=>({}));
        if (!res.ok || !data.success || !data.covers)
          throw Error(data.message || 'Không đọc được thumbnail đã lưu');
        for (const id of group) {
          if (!Object.prototype.hasOwnProperty.call(data.covers,id)) continue;
          // An earlier GET must not overwrite a cover just confirmed by SET.
          if((driveCovers.get(id)?.time||0)>requestedAt)continue;
          const imageId=idOk(data.covers[id]) ? data.covers[id] : null;
          driveCovers.set(id,{imageId,time:Date.now()});
          if(imageId){
            applyFolderCover(id,imageId);
            applyDialogCover(id,imageId);
          }
        }
      }catch(error){
        console.warn('[QL Ảnh] Không thể tải thumbnail folder',error);
      }finally {
        group.forEach(id=>inFlight.delete(id));
      }
    }
  }
  function scanRenderedFolders(force = false){
    scanTimer=null;
    const ids=new Set();
    for(const img of document.querySelectorAll('#folderList img[class*="item-cover-img-"]')){
      for(const name of img.classList) {
        if(!name.startsWith('item-cover-img-'))continue;
        const id=name.slice('item-cover-img-'.length);
        if(idOk(id))ids.add(id);
      }
    }
    for(const id of ids){
      const known=driveCovers.get(id);
      if(known?.imageId)applyFolderCover(id,known.imageId);
    }
    void loadSavedCovers([...ids], force);
  }
  function scheduleFolderScan(){
    if(scanTimer!==null)return;
    scanTimer=setTimeout(scanRenderedFolders,70);
  }
  const folderList=byId('folderList');
  if(folderList && window.MutationObserver){
    new MutationObserver(scheduleFolderScan)
      .observe(folderList,{childList:true,subtree:true});
  }
  scheduleFolderScan();
  // Revalidate from Drive when another device may have changed a cover.
  // Keep the current image displayed while the new result is fetched.
  window.addEventListener('focus', () => scanRenderedFolders(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scanRenderedFolders(true);
  });
  window.addEventListener('online', () => scanRenderedFolders(true));
  setInterval(() => {
    if (!document.hidden && document.visibilityState === 'visible') scanRenderedFolders();
  }, 25000);

  const notify = (message, error = false) => {
    if (typeof window.showToast === 'function') window.showToast(message, error);
    else if (error) console.warn('[QL Ảnh]', message);
  };

  // Capture the exact folder passed to openInfo. currentFolderId is its
  // parent in many views, so it cannot be used for this picker.
  const baseOpenInfo = window.openInfo;
  if (typeof baseOpenInfo === 'function') {
    window.openInfo = function (id, name, type, level, event) {
      edit = type === 'folder' && idOk(id) ? {id, name: String(name || 'Thư mục')} : null;
      cover = null;
      choice = null;
      const result=baseOpenInfo.apply(this, arguments);
      if(edit){
        const known=driveCovers.get(edit.id);
        if(known?.imageId)applyDialogCover(edit.id,known.imageId);
        void loadSavedCovers([edit.id]);
      }
      return result;
    };
  }

  const baseUpload = window.handleCoverUpload;
  if (typeof baseUpload === 'function') {
    window.handleCoverUpload = function (...args) {
      // A subsequent upload from the device takes precedence over a
      // previously chosen folder photo.
      cover = null;
      return baseUpload.apply(this, args);
    };
  }

  function hidePicker() {
    generation++;
    loading = false;
    picker.classList.add('hidden');
    picker.classList.remove('flex');
    choice = null;
    focused?.focus?.();
    focused = null;
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('text-red-600', isError);
    status.classList.toggle('text-gray-500', !isError);
  }

  function render() {
    const filter = search.value.trim().toLocaleLowerCase('vi');
    grid.replaceChildren();
    const visible = images.filter(item => item.name.toLocaleLowerCase('vi').includes(filter));
    const fragment = document.createDocumentFragment();
    for (const item of visible) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'relative rounded-xl overflow-hidden border-2 bg-gray-50 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ' +
        (choice?.id === item.id ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300');
      tile.setAttribute('aria-label', 'Chọn ' + item.name);
      tile.setAttribute('aria-pressed', String(choice?.id === item.id));

      const frame = document.createElement('div');
      frame.className = 'aspect-square w-full bg-gray-100 flex items-center justify-center overflow-hidden';
      const img = document.createElement('img');
      img.src = imageURL(item.id);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.className = 'w-full h-full object-cover';
      img.addEventListener('error', () => {
        frame.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'fas fa-image text-3xl text-gray-300';
        frame.appendChild(icon);
      }, {once:true});
      frame.appendChild(img);

      const name = document.createElement('div');
      name.className = 'p-2 text-xs font-medium text-gray-700 truncate';
      name.textContent = item.name;
      tile.append(frame, name);

      if (choice?.id === item.id) {
        const check = document.createElement('div');
        check.className = 'absolute top-2 right-2 rounded-full bg-blue-600 text-white w-7 h-7 flex items-center justify-center shadow';
        const icon = document.createElement('i');
        icon.className = 'fas fa-check text-xs';
        check.appendChild(icon);
        tile.appendChild(check);
      }
      tile.addEventListener('click', () => {
        choice = item;
        selectedLabel.textContent = 'Đã chọn: ' + item.name;
        confirm.disabled = false;
        render();
      });
      fragment.appendChild(tile);
    }
    grid.appendChild(fragment);
    if (!visible.length && !loading) {
      const empty = document.createElement('p');
      empty.className = 'col-span-full py-10 text-center text-gray-500 text-sm';
      empty.textContent = images.length
        ? 'Không có ảnh trùng tên tìm kiếm trong các ảnh đã tải.'
        : (page ? 'Chưa có ảnh trong trang này. Hãy tải thêm.' : 'Thư mục này chưa có ảnh để chọn.');
      grid.appendChild(empty);
    }
    more.classList.toggle('hidden', !page || loading);
  }

  async function loadPage() {
    if (loading || !edit) return;
    const folderId = edit.id;
    const stamp = generation;
    const nextPage = page;
    loading = true;
    more.classList.add('hidden');
    setStatus('Đang tải ảnh từ thư mục…');
    try {
      const url = '/api/folder-images?' + new URLSearchParams({
        folderId, ...(nextPage ? {pageToken:nextPage} : {})
      });
      const response = await fetch(url, {credentials:'same-origin',cache:'no-store'});
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw Error(json.message || 'Không thể đọc danh sách ảnh');
      if (stamp !== generation || !edit || folderId !== edit.id) return;
      if (json.folderId !== folderId || !Array.isArray(json.images))
        throw Error('Danh sách ảnh trả về không hợp lệ');
      const seen = new Set(images.map(x => x.id));
      for (const item of json.images) {
        if (!idOk(item.id) || seen.has(item.id) || !item.mimeType?.startsWith('image/')) continue;
        images.push({id:item.id,name:String(item.name || 'Ảnh không tên').slice(0,300)});
        seen.add(item.id);
      }
      page = String(json.nextPageToken || '');
      setStatus('Đã tải ' + images.length + ' ảnh trong thư mục.' +
        (page ? ' Có thể tải thêm để xem các ảnh còn lại.' : ''));
    } catch (error) {
      if (stamp !== generation) return;
      setStatus(error.message || 'Không tải được ảnh', true);
      notify(error.message || 'Không tải được ảnh', true);
    } finally {
      if (stamp === generation) {
        loading = false;
        render();
      }
    }
  }

  function openPicker() {
    if (!edit || !idOk(edit.id)) return notify('Chỉ có thể chọn ảnh cho thư mục đang chỉnh sửa.', true);
    if (byId('infoModal')?.classList.contains('hidden')) return;
    focused = document.activeElement;
    generation++;
    loading = false;
    images = [];
    page = '';
    choice = null;
    search.value = '';
    confirm.disabled = true;
    selectedLabel.textContent = 'Chưa chọn ảnh';
    byId('infoFolderImagePath').textContent = edit.name;
    grid.replaceChildren();
    picker.classList.remove('hidden');
    picker.classList.add('flex');
    setStatus('Đang tải ảnh từ thư mục…');
    byId('infoFolderImageClose').focus();
    void loadPage();
  }

  byId('infoPickFromFolderBtn')?.addEventListener('click', openPicker);
  byId('infoFolderImageClose')?.addEventListener('click', hidePicker);
  byId('infoFolderImageCancel')?.addEventListener('click', hidePicker);
  more.addEventListener('click', () => void loadPage());
  search.addEventListener('input', render);
  confirm.addEventListener('click', () => {
    if (!choice || !edit || !idOk(choice.id)) return;
    cover = {folderId:edit.id,fileId:choice.id,url:imageURL(choice.id)};
    // Switch away from an upload in progress in the same edit session.
    window.pendingCoverBase64 = null;
    window.pendingCoverMimeType = null;
    const preview = byId('infoCoverPreview');
    if (preview) {
      preview.src = cover.url;
      preview.classList.remove('hidden');
    }
    byId('infoCoverPlaceholder')?.classList.add('hidden');
    hidePicker();
    notify('Đã chọn ảnh thumbnail. Bấm Lưu để áp dụng.');
  });

  document.addEventListener('keydown', event => {
    if (picker.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hidePicker();
    }
    // Prevent Tab from moving focus behind the modal.
    if (event.key === 'Tab') {
      const controls = Array.from(picker.querySelectorAll('button:not([disabled]):not(.hidden),input:not([disabled])'))
        .filter(el => el.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    }
  });

  function showSaveStatus(message,error=false){
    const el=byId('infoCoverSaveStatus');
    if(!el)return;
    el.textContent=message;
    el.classList.toggle('hidden',!message);
    el.classList.toggle('text-red-600',error);
    el.classList.toggle('text-blue-600',!error);
  }
  // Intercept only saves that changed the cover from the folder's image grid.
  // The old click handler is replayed AFTER Drive confirms the image reference;
  // renaming, description and all existing legacy save behavior stay intact.
  document.addEventListener('click', async event => {
    const target=event.target.closest?.('#infoSaveBtn');
    if (!target || replayLegacySave || !cover || !edit) return;
    if (edit.id !== cover.folderId || !idOk(cover.fileId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(saveBusy)return;

    const selected={...cover};
    saveBusy=true;
    target.disabled=true;
    showSaveStatus('Đang lưu thumbnail vào Google Drive…');
    try {
      const response=await fetch('/api/folder-cover',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'set',folderId:selected.folderId,imageId:selected.fileId
        }),cache:'no-store'
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || !result.success ||
         result.folderId!==selected.folderId || result.imageId!==selected.fileId)
        throw Error(result.message||'Google Drive chưa xác nhận lưu thumbnail');

      driveCovers.set(selected.folderId,{imageId:selected.fileId,time:Date.now()});
      applyFolderCover(selected.folderId,selected.fileId);
      // Once saved, the legacy Save button can commit name/description without
      // uploading a duplicate image or replacing the authoritative Drive cover.
      cover=null;
      window.pendingCoverBase64=null;
      window.pendingCoverMimeType=null;
      showSaveStatus('');
      if(edit?.id===selected.folderId && !byId('infoModal')?.classList.contains('hidden')){
        replayLegacySave=true;
        try {
          target.disabled=false;
          const current=byId('infoSaveBtn');
          current?.click();
        } finally {replayLegacySave=false;}
      }
      repaintKnown();
      setTimeout(repaintKnown,0);
      notify('Đã lưu thumbnail của thư mục trên Google Drive.');
    }catch(error){
      showSaveStatus('Không lưu được ảnh thumbnail: '+error.message,true);
      notify('Không lưu được ảnh thumbnail: '+error.message,true);
    }finally {
      saveBusy=false;
      target.disabled=false;
    }
  },true);

})();
