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
  let queue = [];
  let visitedFolders = new Set();
  let pagesRead = 0;
  let loading = false;
  let generation = 0;

  const imageURL = id => '/api/media?fileId=' + encodeURIComponent(id) + '&variant=thumb';

  // Drive appProperties are the authority for images chosen from the folder.
  // The old obfuscated app reassigns its private appMeta object after startup,
  // so writing window.appMeta does NOT reliably update its actual data model.
  const driveCovers = new Map();
  const inFlight = new Set();
  const CACHE_TTL = 10*60*1000;
  let scanTimer = null;
  let saveBusy = false;
  let replayLegacySave = false;
  let initialFolderFields = null;
  const COVER_STORE = 'vl_folder_covers_v2';
  // A metadata refresh or a re-render must never erase already known covers.
  // Persist references only (not image bytes or Drive authorization).
  function restoreCovers() {
    try {
      const stored = JSON.parse(localStorage.getItem(COVER_STORE) || '{}');
      for (const [id, data] of Object.entries(stored)) {
        if (idOk(id) && idOk(data?.imageId))
          driveCovers.set(id, {imageId:data.imageId, time:0});
      }
    } catch (_) {}
  }
  function rememberCover(id, imageId) {
    if (!idOk(id)) return;
    try {
      const stored = JSON.parse(localStorage.getItem(COVER_STORE) || '{}');
      if (idOk(imageId)) stored[id] = {imageId};
      else delete stored[id];
      const entries = Object.entries(stored).slice(-1500);
      localStorage.setItem(COVER_STORE, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  }
  function folderFields() {
    return ['infoName', 'infoDesc', 'infoType'].map(id => byId(id)?.value ?? '');
  }
  restoreCovers();
  // A second device receives saved Drive cover IDs from the same Redis
  // folder-list snapshot. Only changed cover IDs cause a new image request.
  window.addEventListener('vl:verified-folder-snapshot',event=>{
    const items=event.detail?.items;
    if(!Array.isArray(items))return;
    const updatedAt=Number(event.detail?.updatedAt)||0;
    for(const item of items){
      if(item?.type!=='folder'||!idOk(item.id)||!idOk(item.coverImageId))continue;
      const previous=driveCovers.get(item.id);
      if(previous?.imageId===item.coverImageId){
        // Do not touch an already displayed/decoded IMG.
        if(previous.time===0)driveCovers.set(item.id,{imageId:item.coverImageId,time:Date.now()});
        continue;
      }
      // Stale Redis snapshots must not undo a newer local Drive SET.
      if(previous?.time>updatedAt&&previous.time!==0)continue;
      driveCovers.set(item.id,{imageId:item.coverImageId,time:Date.now()});
      rememberCover(item.id,item.coverImageId);
      applyFolderCover(item.id,item.coverImageId);
    }
  });

  // The thumbnail image and its fallback icon must change atomically.
  // Never hide the folder icon before a real picture has decoded.
  function coverIdFromURL(raw) {
    try {
      const u=new URL(raw||'',location.href);
      const id=u.searchParams.get('fileId')||u.searchParams.get('id')||'';
      return idOk(id)?id:'';
    } catch (_) { return ''; }
  }
  function applyFolderCover(id, imageId) {
    if (!idOk(id) || !idOk(imageId)) return;
    const src=imageURL(imageId);
    const icons=()=>document.querySelectorAll('.item-cover-icon-'+id);
    const showFallback=()=>{
      icons().forEach(icon=>icon.classList.remove('hidden'));
    };
    const showImage=()=>{
      icons().forEach(icon=>icon.classList.add('hidden'));
    };
    document.querySelectorAll('.item-cover-img-'+id).forEach(img=>{
      img.dataset.vlFolderRequestedImage=imageId;
      if (img.dataset.vlFolderCoverWatch!=='1') {
        img.dataset.vlFolderCoverWatch='1';
        img.addEventListener('load',()=>{
          const expected=img.dataset.vlFolderRequestedImage;
          if (!expected || img.naturalWidth<1 ||
              coverIdFromURL(img.currentSrc||img.getAttribute('src'))!==expected)
            return;
          img.style.opacity='';
          img.classList.remove('hidden');
          // Use the live folder ID, not a stale closure after re-render.
          document.querySelectorAll('.item-cover-icon-'+
            [...img.classList].find(x=>x.startsWith('item-cover-img-'))?.slice('item-cover-img-'.length)
          ).forEach(icon=>icon.classList.add('hidden'));
        });
        img.addEventListener('error',()=>{
          if (coverIdFromURL(img.getAttribute('src')) !==
              img.dataset.vlFolderRequestedImage) return;
          img.classList.add('hidden');
          img.style.opacity='';
          const folderClass=[...img.classList].find(x=>x.startsWith('item-cover-img-'));
          const folderId=folderClass?.slice('item-cover-img-'.length);
          if(folderId)document.querySelectorAll('.item-cover-icon-'+folderId)
            .forEach(icon=>icon.classList.remove('hidden'));
        });
      }
      const original=img.getAttribute('src')||'';
      const alreadyDecoded=img.complete && img.naturalWidth>0 &&
        (coverIdFromURL(img.currentSrc||original)===imageId);
      // Existing decoded covers must never be flashed out or re-requested.
      if (alreadyDecoded) {
        img.style.opacity='';
        img.classList.remove('hidden');
        showImage();
        return;
      }
      // The pending preview and fallback are flex siblings. Keep exactly
      // one of them in layout so the row cannot double in width.
      img.loading='eager';
      img.classList.add('hidden');
      img.style.opacity='';
      showFallback();
      const sameProxy=coverIdFromURL(original)===imageId&&
        (()=>{try{const u=new URL(original,location.href);
          return u.origin===location.origin&&u.pathname==='/api/media'&&u.searchParams.get('variant')==='thumb';}
          catch(_){return false;}})();
      if (!sameProxy && original!==src) img.setAttribute('src',src);
      if (img.complete&&img.naturalWidth>0&&
          coverIdFromURL(img.currentSrc||img.getAttribute('src'))===imageId) {
        img.style.opacity='';
        showImage();
      }
    });
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
          rememberCover(id,imageId);
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
  // The one-time Admin job saves Drive references without changing folder
  // lists. Revalidate visible covers once it finishes.
  window.addEventListener('vl:bulk-covers-saved', () => scanRenderedFolders(true));
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
      initialFolderFields = edit ? folderFields() : null;
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
    const matching = images.filter(item => (item.path + ' / ' + item.name).toLocaleLowerCase('vi').includes(filter));
    const visible = matching.slice(0,300); // Keep the modal responsive in very large trees.
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
      name.textContent = item.path ? item.path + ' / ' + item.name : item.name;
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
        selectedLabel.textContent = 'Đã chọn: ' + (item.path ? item.path + ' / ' : '') + item.name;
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
        ? 'Không có ảnh trùng từ khóa tìm kiếm.'
        : loading ? 'Đang kiểm tra thư mục này và các thư mục con…'
        : 'Không tìm thấy ảnh trong thư mục hoặc toàn bộ thư mục con.';
      grid.appendChild(empty);
    }
    more.classList.toggle('hidden', !queue.length || loading);
  }

  // Breadth-first traversal: each request is scoped to ONE verified Drive
  // folder. Paging and a visited set handle arbitrarily deep descendants
  // without scanning the entire Shared Drive in any single server call.
  async function loadPage() {
    if (loading || !edit || !queue.length) return;
    const folderId = edit.id;
    const stamp = generation;
    loading = true;
    more.classList.add('hidden');
    setStatus('Đang tìm ảnh trong thư mục và tất cả thư mục con…');
    try {
      let changes = 0;
      while (queue.length && stamp === generation && edit?.id === folderId &&
             !picker.classList.contains('hidden')) {
        const task = queue[0];
        const url = '/api/folder-images?' + new URLSearchParams({
          folderId:task.id, withFolders:'1',
          ...(task.page ? {pageToken:task.page} : {})
        });
        const response = await fetch(url, {credentials:'same-origin',cache:'no-store'});
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) throw Error(json.message || 'Không thể duyệt thư mục con');
        if (stamp !== generation || !edit || folderId !== edit.id) return;
        if (json.folderId !== task.id || !Array.isArray(json.images) ||
            !Array.isArray(json.folders))
          throw Error('Danh sách ảnh/thư mục trả về không hợp lệ');

        const known = new Set(images.map(x=>x.id));
        for (const item of json.images) {
          if (!idOk(item.id) || known.has(item.id) || !item.mimeType?.startsWith('image/')) continue;
          images.push({id:item.id,name:String(item.name || 'Ảnh không tên').slice(0,300),
            path:task.path});
          known.add(item.id);
        }
        for (const sub of json.folders) {
          if (!idOk(sub.id) || visitedFolders.has(sub.id)) continue;
          visitedFolders.add(sub.id);
          const path = task.path ? task.path + ' / ' + String(sub.name || 'Thư mục') :
            String(sub.name || 'Thư mục');
          queue.push({id:sub.id,page:'',path});
        }
        task.page=String(json.nextPageToken||'');
        if (!task.page) queue.shift();
        pagesRead++;
        changes++;
        setStatus('Đã tìm thấy '+images.length+' ảnh · đang duyệt '+
          visitedFolders.size+' thư mục (gồm các cấp con).');
        // Render in batches so image nodes never flash/rebuild per API page.
        if (changes >= 3 || !queue.length) {
          changes=0;
          render();
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        // Prevent unbounded automatic request storms in extremely large
        // trees. The user can continue at exactly this position with Xem thêm.
        if (pagesRead % 300 === 0 && queue.length) {
          setStatus('Đã kiểm tra '+pagesRead+' trang. Còn thư mục con; bấm Tải thêm để tiếp tục.');
          break;
        }
      }
      if (!queue.length && stamp === generation)
        setStatus('Đã duyệt toàn bộ '+visitedFolders.size+' thư mục · tìm thấy '+images.length+' ảnh.');
    } catch (error) {
      if (stamp !== generation) return;
      setStatus(error.message || 'Không tải được ảnh trong thư mục con', true);
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
    queue = [{id:edit.id,page:'',path:''}];
    visitedFolders = new Set([edit.id]);
    pagesRead = 0;
    choice = null;
    search.value = '';
    confirm.disabled = true;
    selectedLabel.textContent = 'Chưa chọn ảnh';
    byId('infoFolderImagePath').textContent = edit.name + ' (gồm mọi cấp thư mục con)';
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
      rememberCover(selected.folderId,selected.fileId);
      applyFolderCover(selected.folderId,selected.fileId);
      // Once saved, the legacy Save button can commit name/description without
      // uploading a duplicate image or replacing the authoritative Drive cover.
      cover=null;
      window.pendingCoverBase64=null;
      window.pendingCoverMimeType=null;
      showSaveStatus('');
      if(edit?.id===selected.folderId && !byId('infoModal')?.classList.contains('hidden')){
        const fieldsChanged = !initialFolderFields ||
          folderFields().some((value,index)=>value!==initialFolderFields[index]);
        if(fieldsChanged){
          // Preserve the original rename/description/type save behavior only
          // when one of those fields was actually modified.
          replayLegacySave=true;
          try {
            target.disabled=false;
            byId('infoSaveBtn')?.click();
          } finally {replayLegacySave=false;}
        } else if(typeof window.closeInfoModal==='function'){
          // Cover-only save is already committed by /api/folder-cover.
          // The legacy save would invalidate/re-render the entire folder list.
          window.closeInfoModal();
        }
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
