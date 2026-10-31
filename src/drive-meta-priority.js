/* Drive has the authoritative folder/file name. The LOẠI Sheet keeps only metadata.
   Install before the legacy app so every list/getMeta response stays consistent. */
(function () {
  'use strict';
  if (window.__vinhlocDriveMetaPriorityInstalled) return;
  window.__vinhlocDriveMetaPriorityInstalled = true;
  const names = window.__vinhlocDriveNames || (window.__vinhlocDriveNames = Object.create(null));
  const nativeFetch = window.fetch.bind(window);
  const liveItems = new Map();

  function applyToApp() {
    let meta;
    try { meta = typeof appMeta !== 'undefined' ? appMeta : window.appMeta; } catch (_) {}
    if (meta && typeof meta === 'object') {
      for (const id of Object.keys(names)) {
        if (meta[id] && typeof meta[id] === 'object' && meta[id].name !== names[id])
          meta[id].name = names[id];
      }
    }
    for (const cacheName of ['folderDataCache', 'subFolderCache']) {
      let cache;
      try {
        cache = cacheName === 'folderDataCache'
          ? (typeof folderDataCache !== 'undefined' ? folderDataCache : window.folderDataCache)
          : (typeof subFolderCache !== 'undefined' ? subFolderCache : window.subFolderCache);
      } catch (_) {}
      if (!cache || typeof cache !== 'object') continue;
      for (const items of Object.values(cache)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (item && names[item.id] && item.name !== names[item.id]) item.name = names[item.id];
        }
      }
    }
  }

  function remember(items, parentId = null) {
    if (parentId && typeof parentId === 'string')
      liveItems.set(parentId, items.map(item => ({...item})));
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && typeof item.id === 'string' && typeof item.name === 'string' && !item.isPending)
        names[item.id] = item.name;
    }
    applyToApp();
  }

  function correctMeta(meta) {
    if (!meta || typeof meta !== 'object') return;
    for (const id of Object.keys(names)) {
      if (meta[id] && typeof meta[id] === 'object') meta[id].name = names[id];
    }
  }

  function correctListCache(cache, preferLive = false, folderOnly = false) {
    if (!cache || typeof cache !== 'object') return;
    if (preferLive) for (const [id, current] of liveItems)
      cache[id] = current.filter(item => !folderOnly || item.type === 'folder').map(item => ({...item}));
    for (const items of Object.values(cache)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item && names[item.id]) item.name = names[item.id];
      }
    }
  }

  function patchResponse(response, value) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(value), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = function (input, init) {
    let action;
    let parentId = null;
    try {
      if (init && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        action = body && body.action;
        parentId = body && body.folderId;
      }
    } catch (_) {}
    const request = nativeFetch(input, init);
    if (!['list', 'getMeta', 'loadGlobalCache'].includes(action)) return request;
    return request.then(async (response) => {
      if (!response.ok) return response;
      try {
        const value = await response.clone().json();
        if (!value || value.success !== true) return response;
        if (action === 'list') {
          // The backend list action reads DriveApp.getFolders/getFiles directly.
          remember(value.data, parentId);
          return response;
        }
        if (action === 'getMeta') {
          correctMeta(value.meta);
          return patchResponse(response, value);
        }
        if (action === 'loadGlobalCache' && value.data) {
          correctMeta(value.data.appMeta);
          correctListCache(value.data.folderData, true);
          correctListCache(value.data.subData, true, true);
          return patchResponse(response, value);
        }
      } catch (error) {
        console.warn('[QL Ảnh] Không thể hợp nhất tên Drive:', error);
      }
      return response;
    });
  };

  // Late legacy patches can restore old Sheet names while painting the DOM.
  // Reconcile the visible label by immutable Drive ID, without changing its clicks/menus.
  function syncLabels() {
    applyToApp();
    for (const [id, name] of Object.entries(names)) {
      const labels = document.getElementsByClassName('item-name-' + id);
      for (const label of labels) {
        if (label.textContent !== name) label.textContent = name;
      }
    }
  }
  setInterval(syncLabels, 1300);
  window.addEventListener('focus', syncLabels);
  window.__vinhlocRecordDriveList = remember;
})();