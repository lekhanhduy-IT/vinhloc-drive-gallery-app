/* QL Anh reliable create + multi-upload. Loaded after the legacy application.
   Server confirmation is the only source of a real Drive folder/file ID. */
(() => {
  'use strict';
  if (window.__vlReliableUploadInstalled) return;
  window.__vlReliableUploadInstalled = true;
  const ENDPOINT_FALLBACK = 'https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';
  const CHUNK_SIZE = 5 * 1024 * 1024; // 20 * Drive's 256-KiB alignment.
  const SELF = {token: null, tokenAt: 0, tokenPromise: null, processing: false};
  const rootId = '1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT';
  function read(name) {
    try {
      switch (name) {
        case 'folder': return typeof currentFolderId !== 'undefined' ? currentFolderId : window.currentFolderId;
        case 'items': return typeof currentDriveItems !== 'undefined' ? currentDriveItems : window.currentDriveItems;
        case 'cache': return typeof folderDataCache !== 'undefined' ? folderDataCache : window.folderDataCache;
        case 'sub': return typeof subFolderCache !== 'undefined' ? subFolderCache : window.subFolderCache;
        case 'category': return typeof currentCategory !== 'undefined' ? currentCategory : 'Triển khai';
        case 'meta': return typeof appMeta !== 'undefined' ? appMeta : window.appMeta;
        case 'endpoint': return typeof SCRIPT_URL !== 'undefined' ? SCRIPT_URL : ENDPOINT_FALLBACK;
      }
    } catch (_) { return null; }
  }
  function toast(message, bad = false) {
    if (typeof window.showToast === 'function') window.showToast(message, bad);
    else console[bad ? 'warn' : 'info']('[QL Ảnh]', message);
  }
  async function api(action, params = {}) {
    const res = await fetch(read('endpoint') || ENDPOINT_FALLBACK, {
      method: 'POST',
      body: JSON.stringify({action, ...params}),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('Máy chủ không phản hồi (' + res.status + ')');
    const data = await res.json();
    if (!data || !data.success) throw new Error(data?.message || data?.error || 'Không thể xử lý trên Drive');
    return data;
  }
  function isAdminClient() {
    return String(localStorage.getItem('vinhloc_authenticated_email')||'').toLowerCase() === 'admin@tudonghoavinhloc.com';
  }
  async function ownApi(action, params = {}) {
    const res = await fetch('/api/owned-files', {
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...params}),cache:'no-store'
    });
    const json=await res.json().catch(()=>({}));
    if(!res.ok || !json.success) {
      if(res.status===401) void window.vlMediaEnsureAuth?.();
      throw new Error(json.message || 'Cần đăng nhập Google để ghi nhận người upload');
    }
    return json;
  }
  async function driveToken(force = false) {
    if (!force && SELF.token && Date.now() - SELF.tokenAt < 15 * 60000) return SELF.token;
    if (SELF.tokenPromise && !force) return SELF.tokenPromise;
    SELF.tokenPromise = api('getToken').then(data => {
      if (!data.token) throw new Error('Không có quyền Drive');
      SELF.token = data.token; SELF.tokenAt = Date.now(); return data.token;
    }).finally(() => { SELF.tokenPromise = null; });
    return SELF.tokenPromise;
  }
  // Reuse one token provider for thumbnails and viewers. Only memory, never a URL/storage.
  window.vlGetMediaAccessToken = driveToken;

  function getList(id) {
    const cache = read('cache');
    return cache && Array.isArray(cache[id]) ? cache[id] : [];
  }
  // 'tempUrl' is an upload-in-progress FLAG in the legacy renderer,
  // not merely a preview URL. Retaining it after Drive returns an ID keeps
  // the opaque "Đang Up..." overlay visible forever on the uploading device.
  function normalized(item) {
    if (!item) return item;
    if (item.isPending && String(item.id).startsWith('temp_file_')) return item;
    if (!item.tempUrl && !item.isPending) return item;
    const clean = {...item};
    delete clean.tempUrl;
    delete clean.isPending;
    return clean;
  }
  function setList(id, list) {
    list = list.map(normalized);
    const cache = read('cache');
    if (cache) {
      cache[id] = list;
      if (window.localforage) {
        // Blob URLs are browser-session-only and should not be serialized to IndexedDB.
        const stored = Object.fromEntries(Object.entries(cache).map(([folderId, items]) => [
          folderId, Array.isArray(items) ? items.map(i => { const {tempUrl, ...rest} = i; return rest; }) : items
        ]));
        void localforage.setItem('vinhloc_folder_cache', stored).catch(console.warn);
      }
    }
    if (id === read('folder')) {
      try { currentDriveItems = list; } catch (_) {}
      if (typeof window.renderItems === 'function') window.renderItems(list);
    }
  }
  function upsert(id, item, oldId = null) {
    const clean = normalized(item);
    // A spider refresh may already have published the real Drive ID while
    // the upload request was finishing. Remove both representations.
    const list = getList(id).filter(i => i.id !== clean.id && i.id !== oldId);
    list.unshift(clean);
    setList(id, list);
  }
  function remove(id, itemId) {
    setList(id, getList(id).filter(i => i.id !== itemId));
  }

  // The old dialog queues createFolder with a fake ID, so its first upload
  // targets a non-existent Drive parent. Replace only the confirmation step.
  let wrappedCreator = null;
  function installCreator() {
    const previous = window.uiPromptFolder;
    if (typeof previous !== 'function' || previous === wrappedCreator || previous.__vlReliable) return;
    const replacement = function(targetParentId = null, event = null) {
      const result = previous.apply(this, arguments);
      const btn = document.getElementById('modalConfirmBtn');
      const input = document.getElementById('modalInput');
      if (!btn || !input) return result;
      btn.onclick = async () => {
        const name = input.value.trim();
        if (!name || btn.disabled) return;
        const parentId = typeof targetParentId === 'string' && targetParentId ? targetParentId : read('folder');
        if (!parentId || parentId.startsWith('temp_folder_')) {
          toast('Thư mục cha chưa có ID thật. Vui lòng thử lại.', true);
          return;
        }
        btn.disabled = true;
        const previousText = btn.textContent;
        btn.textContent = 'Đang tạo...';
        try {
          const isMegaRow = parentId === rootId;
          const response = await (isAdminClient() ? api('createFolder', {
            name, folderId: parentId, isMegaRow, category: read('category')
          }) : ownApi('createFolder', {
            name, folderId:parentId, category:read('category')
          }));
          const newId = response.id;
          if (!newId || newId.startsWith('temp_')) throw new Error('Drive chưa trả về ID thật');
          const item = {id: newId, name, type: 'folder', ...(isAdminClient()?{}:{uploadedBy:response.uploaderEmail})};
          const meta = read('meta');
          if (meta) meta[newId] = {
            ...(meta[newId] || {}),
            name, type: read('category'), desc: meta[newId]?.desc || '', cover: meta[newId]?.cover || ''
          };
          if (window.localforage && meta) void localforage.setItem('vinhloc_meta', meta);
          const oldList = getList(parentId);
          const merged = [item, ...oldList.filter(i => i.id !== newId)];
          // Do not overwrite another directory if the user navigated while saving.
          if (parentId === read('folder')) setList(parentId, merged);
          else {
            const cache = read('cache');
            if (cache) cache[parentId] = merged;
            const subs = read('sub');
            if (subs) {
              subs[parentId] = [item, ...(subs[parentId] || []).filter(i => i.id !== newId)];
              if (window.localforage) void localforage.setItem('vinhloc_subfolder_cache', subs);
              if (typeof renderSubFolders === 'function' && document.getElementById('acc-' + parentId))
                renderSubFolders(parentId, subs[parentId]);
            }
          }
          const modal = document.getElementById('customModal');
          if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
          toast('Đã tạo "' + name + '" trên Drive. Có thể mở và tải ảnh/video ngay.');
        } catch (err) {
          toast('Không tạo được thư mục: ' + err.message, true);
        } finally {
          btn.textContent = previousText || 'Tạo';
          btn.disabled = false;
        }
      };
      return result;
    };
    replacement.__vlReliable = true;
    wrappedCreator = replacement;
    window.uiPromptFolder = replacement;
  }

  async function createUploadSession(file, folderId, token) {
    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size';
    const init = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(file.size)
      },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        parents: [folderId]
      })
    });
    if (!init.ok) {
      const err = await init.text().catch(() => '');
      const e = new Error('Drive từ chối upload (' + init.status + '): ' + err.slice(0, 130));
      e.status = init.status;
      throw e;
    }
    const location = init.headers.get('Location');
    if (!location) throw new Error('Drive chưa cấp phiên upload');
    return location;
  }
  async function transferFile(file, folderId, token) {
    let url;
    if (!isAdminClient()) {
      const created = await ownApi('startUpload',{
        folderId, name:file.name, mimeType:file.type, size:file.size
      });
      url = created.uploadUrl;
    } else {
      try { url = await createUploadSession(file, folderId, token); }
      catch (error) {
        if (error.status !== 401) throw error;
        url = await createUploadSession(file, folderId, await driveToken(true));
      }
    }
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + CHUNK_SIZE);
      const part = await fetch(url, {
        method: 'PUT',
        headers: {'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + file.size},
        body: file.slice(offset, end)
      });
      if (part.status === 308) {
        const range = part.headers.get('Range');
        const matched = range && range.match(/bytes=0-(\d+)$/);
        const confirmed = matched ? Number(matched[1]) + 1 : end;
        if (confirmed <= offset) throw new Error('Drive không xác nhận dữ liệu đã tải');
        offset = confirmed;
        continue;
      }
      if (!part.ok) throw new Error('Lỗi truyền file (' + part.status + ')');
      const uploaded = await part.json().catch(() => null);
      if (uploaded?.id) return uploaded;
      throw new Error('Drive không trả về ID file mới');
    }
    throw new Error('Phiên upload kết thúc nhưng chưa xác nhận tệp');
  }
  function setBusy(active) {
    try {
      if (typeof syncQueueCount !== 'undefined') {
        syncQueueCount += active ? 1 : -1;
        if (syncQueueCount < 0) syncQueueCount = 0;
        if (typeof window.updateSyncIndicator === 'function') window.updateSyncIndicator();
      }
    } catch (_) {}
  }
  async function uploadFiles(files) {
    const chosen = Array.from(files || []).filter(f => f && f.size > 0);
    if (!chosen.length) { toast('Không có file hợp lệ để tải lên.', true); return; }
    if (SELF.processing) { toast('Đang tải một đợt file. Vui lòng hoàn tất trước khi chọn đợt khác.', true); return; }
    const folderId = read('folder');
    if (!folderId || folderId.startsWith('temp_folder_')) {
      toast('Thư mục chưa có ID thật. Vui lòng tạo xong thư mục trước.', true); return;
    }
    SELF.processing = true;
    setBusy(true);
    const startedAt = Date.now();
    const pending = chosen.map((file, index) => {
      const tempId = 'temp_file_vl_' + startedAt + '_' + index;
      const tempUrl = URL.createObjectURL(file);
      return {file, tempId, tempUrl, data: {
        id: tempId, name: file.name, type: 'file',
        mimeType: file.type || 'application/octet-stream',
        isPending: true, tempUrl, uploadStartedAt: startedAt, size: file.size
      }};
    });
    window.vlActiveUploadIds ||= new Set();
    for(const item of pending)window.vlActiveUploadIds.add(item.tempId);
    setList(folderId, [...pending.map(p => p.data), ...getList(folderId)]);
    let success = 0, failure = 0;
    toast('Đang tải ' + chosen.length + ' file lên Google Drive...');
    try {
      let token = isAdminClient() ? await driveToken() : null;
      for (const item of pending) {
        try {
          const completed = await transferFile(item.file, folderId, token);
          const {tempUrl: discardedPreviewFlag, isPending: discardedPending, ...uploadData} = item.data;
          const fileData = {
            ...uploadData, id: completed.id, name: completed.name || item.file.name,
            mimeType: completed.mimeType || item.data.mimeType,
            isPending: false, recentlyUploadedAt: Date.now(),
            ...(!isAdminClient()?{uploadedBy:localStorage.getItem('vinhloc_authenticated_email')}: {})
          };
          // Retain the local preview for this session; other devices use authenticated fallback.
          upsert(folderId, fileData, item.tempId);
          window.vlActiveUploadIds?.delete(item.tempId);
          // Local preview no longer controls the upload state after success.
          URL.revokeObjectURL(item.tempUrl);
          success++;
        } catch (err) {
          failure++;
          window.vlActiveUploadIds?.delete(item.tempId);
          remove(folderId, item.tempId);
          URL.revokeObjectURL(item.tempUrl);
          toast('Lỗi ' + item.file.name + ': ' + err.message, true);
        }
      }
      toast('Upload hoàn tất: ' + success + '/' + chosen.length + ' file.' +
        (failure ? ' Thất bại: ' + failure + '.' : ''), failure > 0);
    } catch (error) {
      for (const item of pending) {
        if (getList(folderId).some(f => f.id === item.tempId)) {
          remove(folderId, item.tempId);
          URL.revokeObjectURL(item.tempUrl);
        }
      }
      toast('Upload chưa thực hiện được: ' + error.message, true);
    } finally {
      for(const item of pending)window.vlActiveUploadIds?.delete(item.tempId);
      SELF.processing = false;
      setBusy(false);
    }
  }
  window.vlUploadFiles = uploadFiles;

  // The first picker must always be multiple; camera capture intentionally stays single.
  // Capture before the legacy label handlers / non-configurable upload function.
  function openMultiplePicker(accept) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = accept;
    picker.multiple = true;
    picker.style.display = 'none';
    picker.addEventListener('change', () => {
      const selected = Array.from(picker.files || []);
      picker.remove();
      void uploadFiles(selected);
    }, {once:true});
    document.body.appendChild(picker);
    picker.click();
  }
  document.addEventListener('click', evt => {
    const label = evt.target.closest?.('label');
    if (!label) return;
    const image = label.querySelector('#uploadImage');
    const video = label.querySelector('#uploadVideo');
    if (!image && !video) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    openMultiplePicker(image ? 'image/*' : 'video/*');
  }, true);
  document.addEventListener('change', evt => {
    if (!evt.target?.matches?.('#captureImage, #captureVideo')) return;
    const files = Array.from(evt.target.files || []);
    evt.stopImmediatePropagation();
    evt.target.value = '';
    void uploadFiles(files);
  }, true);

  installCreator();
  setInterval(installCreator, 1200);
})();