/* QL Ảnh: reconcile external Google Drive changes with IndexedDB caches.
   This file runs after the existing (protected) application script. */
(() => {
  'use strict';
  const REFRESH_INTERVAL = 30000;
  const REQUEST_TIMEOUT = 15000;
  let running = null;
  let lastRun = 0;
  const driveNames = new Map();
  let installedRenderer = null;
  // The legacy renderer forces names from Sheets metadata, even when Drive has changed.
  // Keep the current Drive name authoritative at render time without altering other metadata.
  function installRendererGuard() {
    const original = window.renderItems;
    if (typeof original !== 'function' || original === installedRenderer) return;
    const wrapped = function(items, ...args) {
      if (Array.isArray(items)) items.forEach(item => {
        const liveName = driveNames.get(item.id);
        if (!liveName) return;
        item.name = liveName;
        try {
          if (typeof appMeta !== 'undefined' && appMeta[item.id]) appMeta[item.id].name = liveName;
        } catch (_) {}
      });
      return original.call(this, items, ...args);
    };
    installedRenderer = wrapped;
    window.renderItems = wrapped;
  }

  // The original classic script declares these as top-level lexical variables.
  // Reading them here (rather than window.*) follows later reassignments.
  function stack() {
    try { return typeof folderStack !== 'undefined' && Array.isArray(folderStack) ? folderStack : []; }
    catch (_) { return []; }
  }
  function activeFolder() {
    try { return typeof currentFolderId !== 'undefined' ? currentFolderId : null; }
    catch (_) { return null; }
  }
  function folderCache() {
    try { return typeof folderDataCache !== 'undefined' ? folderDataCache : null; }
    catch (_) { return null; }
  }
  function subCache() {
    try { return typeof subFolderCache !== 'undefined' ? subFolderCache : null; }
    catch (_) { return null; }
  }
  function busy() {
    try { return typeof syncQueueCount !== 'undefined' && syncQueueCount > 0; }
    catch (_) { return false; }
  }
  function endpoint() {
    try { return typeof SCRIPT_URL !== 'undefined' ? SCRIPT_URL : null; }
    catch (_) { return null; }
  }
  function canRefresh(force) {
    if (!force && (document.hidden || Date.now() - lastRun < 12000)) return false;
    if (new URLSearchParams(location.search).has('shareId')) return false;
    // The old loading overlay can stay mounted after login; do not block Drive reads.
    if ((!force && busy()) || !endpoint() || !activeFolder()) return false;
    return !!folderCache();
  }
  function signature(items) {
    return JSON.stringify(items.map(item =>
      [item.id, item.type, item.name, item.mimeType || '', !!item.isPending]));
  }
  function mergePending(oldItems, freshItems) {
    const pending = new Map(oldItems.filter(item => item && (
      item.isPending || (item.recentlyUploadedAt && Date.now() - item.recentlyUploadedAt < 120000)
    )).map(item => [item.id, item]));
    const merged = freshItems.map(item => pending.get(item.id) || item);
    const ids = new Set(merged.map(item => item.id));
    pending.forEach((item, id) => { if (!ids.has(id)) merged.push(item); });
    return merged;
  }
  async function directDriveList(id) {
    if (typeof window.vlGetMediaAccessToken !== 'function')
      throw new Error('Không có thông tin phiên Drive');
    const token = await window.vlGetMediaAccessToken();
    const result = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({
        q: "'" + id + "' in parents and trashed = false",
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives'
      });
      if (pageToken) query.set('pageToken', pageToken);
      const res = await fetch('https://www.googleapis.com/drive/v3/files?' + query, {
        headers: {Authorization: 'Bearer ' + token},
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('Drive API (' + res.status + ')');
      const body = await res.json();
      if (!Array.isArray(body.files)) throw new Error('Drive API không trả danh sách tệp');
      for (const file of body.files) {
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
        result.push({
          id: file.id,
          name: file.name,
          type: isFolder ? 'folder' : 'file',
          ...(!isFolder ? {mimeType:file.mimeType, url:file.webViewLink || ''} : {})
        });
      }
      pageToken = body.nextPageToken || '';
    } while (pageToken);
    result.sort((a, b) => a.type === b.type ?
      a.name.localeCompare(b.name, 'vi') : a.type === 'folder' ? -1 : 1);
    return result;
  }

  async function liveList(id) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let fromAppsScript = null;
    let appsScriptError = null;
    try {
      const payload = { action: 'list', folderId: id };
      try {
        if (typeof currentUserEmail !== 'undefined' && currentUserEmail)
          payload.email = currentUserEmail;
      } catch (_) {}
      const response = await fetch(endpoint(), {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (!result || result.success !== true || !Array.isArray(result.data))
        throw new Error('Apps Script không trả về danh sách thư mục hợp lệ');
      fromAppsScript = result.data;
      if (fromAppsScript.length) return fromAppsScript;
    } catch (error) {
      appsScriptError = error;
    } finally {
      clearTimeout(timeout);
    }

    // A stale 'empty' result should not erase a newly uploaded folder. A direct
    // Drive API list is authoritative and works across devices without their
    // browser's IndexedDB / spider-memory cache.
    try {
      return await directDriveList(id);
    } catch (fallbackError) {
      if (appsScriptError) throw appsScriptError;
      if (fromAppsScript) return fromAppsScript; // Truly empty, or no direct permission.
      throw fallbackError;
    }
  }
  function mayRender() {
    const search = document.getElementById('searchInput');
    const modal = document.getElementById('infoModal');
    return (!search || !search.value.trim()) &&
      (!modal || modal.classList.contains('hidden')) &&
      !document.querySelector('.multi-select-toolbar:not(.hidden)');
  }
  async function syncOne(id) {
    // Capture old values BEFORE the response interceptor updates in-memory names.
    // Otherwise a rename can appear unchanged and suppress the real UI re-render.
    const existing = folderCache();
    const previousSignature = existing && Array.isArray(existing[id]) ? signature(existing[id]) : null;
    const fromDrive = await liveList(id);
    const fresh = typeof window.vlVerifiedDeletions?.safe === 'function'
      ? window.vlVerifiedDeletions.safe(fromDrive) : fromDrive;
    for (const item of fresh) if (item && item.id && item.name) driveNames.set(item.id, item.name);
    if (typeof window.__vinhlocRecordDriveList === 'function') window.__vinhlocRecordDriveList(fresh, id);
    installRendererGuard();
    try {
      if (typeof appMeta !== 'undefined') {
        fresh.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) appMeta[item.id].name = item.name; });
      }
    } catch (_) {}
    const cache = folderCache();
    if (!cache) return fresh;
    const previous = Array.isArray(cache[id]) ? cache[id] : [];
    const merged = mergePending(previous, fresh);
    const changed = previousSignature === null || previousSignature !== signature(merged);
    if (changed) {
      cache[id] = merged;
      const sub = subCache();
      if (sub && Object.prototype.hasOwnProperty.call(sub, id)) {
        sub[id] = merged.filter(item => item.type === 'folder');
        const accordion = document.getElementById('acc-' + id);
        if (accordion && !accordion.classList.contains('hidden') &&
            typeof renderSubFolders === 'function') {
          renderSubFolders(id, sub[id]);
        }
      }
      if (activeFolder() === id && mayRender() && typeof window.renderItems === 'function') {
        try { currentDriveItems = merged; } catch (_) {}
        const container = document.getElementById('contentArea');
        const scrollY = container ? container.scrollTop : 0;
        window.renderItems(merged);
        if (container) container.scrollTop = scrollY;
      }
      if (window.localforage) {
        await localforage.setItem('vinhloc_folder_cache', cache);
        if (sub) await localforage.setItem('vinhloc_subfolder_cache', sub);
      }
    }
    // Cached old names might have been rendered by a later global-cache response.
    // Always reconcile the visible names from the live list, even when arrays compare equal.
    for (const item of merged) {
      const label = document.querySelector('.item-name-' + CSS.escape(item.id));
      if (label && label.textContent.trim() !== item.name) label.textContent = item.name;
    }
    return merged;
  }
  function updatePathFromParents(path, liveParents) {
    const actual = stack();
    if (!actual.length || actual.length !== path.length ||
        actual.some((item, i) => item.id !== path[i].id)) return;

    // IMPORTANT: QL Anh intentionally flattens Drive's physical hierarchy.
    // Example: ROOT > "SUA CHUA THIET BI" > "1. SUA BIEN TAN" > "ABB"
    // appears in the UI as ROOT > "1. SUA BIEN TAN" > "ABB".
    // Missing a direct child in a parent listing DOES NOT prove that
    // a folder was moved. Never automatically navigate or truncate
    // folderStack from a background synchronization.
    let renamed = false;
    for (let i = 1; i < actual.length; i++) {
      const children = liveParents.get(actual[i - 1].id);
      if (!Array.isArray(children)) continue;
      const matchingChild = children.find(item => item.type === 'folder' && item.id === actual[i].id);
      if (!matchingChild) continue; // Virtual/flattened path: retain current navigation.
      if (actual[i].name !== matchingChild.name) {
        actual[i].name = matchingChild.name;
        renamed = true;
      }
    }
    if (renamed) {
      localStorage.setItem('appFolderStack', JSON.stringify(actual));
      if (typeof window.updateBreadcrumbs === 'function') window.updateBreadcrumbs();
    }
  }
  async function refresh(force = false) {
    if (running) return running;
    if (!canRefresh(force)) return false;
    running = (async () => {
      const path = stack().map(item => ({ id: item.id, name: item.name }));
      const originalActive = activeFolder();
      if (!path.length || originalActive !== path[path.length - 1].id) return false;
      const liveParents = new Map();
      let allSucceeded = true;
      // Refresh every ancestor; this detects renamed and moved folders.
      for (const parent of path.slice(0, -1)) {
        try { liveParents.set(parent.id, await syncOne(parent.id)); }
        catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Không thể kiểm tra', parent.id, err); }
      }
      updatePathFromParents(path, liveParents);
      if (activeFolder() === originalActive) {
        try { await syncOne(originalActive); }
        catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Đồng bộ Drive thất bại', err); }
      }
      // The root displays expanded mega-folder rows from a separate subfolder cache.
      if (activeFolder() === originalActive && path.length === 1) {
        const opened = Array.from(document.querySelectorAll('[id^="acc-"]:not(.hidden)'))
          .map(element => element.id.slice(4)).filter(Boolean).slice(0, 12);
        for (const id of opened) {
          try { await syncOne(id); }
          catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Không thể cập nhật thư mục con', id, err); }
        }
      }
      lastRun = Date.now();
      return allSucceeded;
    })();
    try { return await running; }
    finally { running = null; }
  }
  function installButton() {
    if (document.getElementById('btnDriveLiveSync')) return;
    const heading = document.getElementById('currentFolderName');
    if (!heading || !heading.parentNode) return;
    const button = document.createElement('button');
    button.id = 'btnDriveLiveSync';
    button.type = 'button';
    button.title = 'Đồng bộ thay đổi mới nhất từ Google Drive';
    button.setAttribute('aria-label', 'Đồng bộ thư mục từ Google Drive');
    button.className = 'w-8 h-8 shrink-0 rounded-full text-white/90 hover:bg-white/15 flex items-center justify-center';
    button.innerHTML = '<i class="fas fa-sync-alt"></i>';
    heading.insertAdjacentElement('afterend', button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.querySelector('i').classList.add('fa-spin');
      try {
        const success = await refresh(true);
        if (typeof window.showToast === 'function')
          window.showToast(success ? 'Đã kiểm tra dữ liệu mới trên Drive.' :
            'Chưa thể đồng bộ. Hãy kiểm tra kết nối hoặc quyền truy cập.', !success);
      } finally {
        button.disabled = false;
        button.querySelector('i').classList.remove('fa-spin');
      }
    });
  }
  function start() {
    installButton();
    // Revalidate a newly opened directory instead of waiting the 30-second
    // crawler cycle. Keep navigation unchanged, even with flattened paths.
    let observedFolder = activeFolder();
    setInterval(() => {
      const next = activeFolder();
      if (!next || next === observedFolder) return;
      observedFolder = next;
      setTimeout(() => {
        if (activeFolder() === next) void refresh(true);
      }, 250);
    }, 850);
    installRendererGuard();
    setInterval(installRendererGuard, 1200);
    // Existing application initializes its protected startup in a delayed task.
    setTimeout(() => { void refresh(true); }, 3000);
    setTimeout(() => { void refresh(true); }, 11000);
    setInterval(() => { void refresh(false); }, REFRESH_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refresh(true);
    });
    window.addEventListener('focus', () => { void refresh(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.vinhlocLiveDriveSync = () => refresh(true);
})();