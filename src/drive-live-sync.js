/* QL Ảnh: reconcile external Google Drive changes with IndexedDB caches.
   This file runs after the existing (protected) application script. */
(() => {
  'use strict';
  const REFRESH_INTERVAL = 12000;
  const FULL_REFRESH_INTERVAL = 45000;
  const REQUEST_TIMEOUT = 15000;
  let running = null;
  let lastRun = 0;
  let lastDeepRun = 0;
  const driveNames = new Map();
  let installedRenderer = null;
  let lastPaintKey = '';
  // Avoid throwing away decoded <img> nodes when a background sync paints the
  // SAME file IDs and metadata again. Replacing innerHTML causes loaded
  // previews to disappear and start network/fallback recovery from zero.
  function sameFileCards(files) {
    const list=document.getElementById('fileList');
    if(!list || list.children.length!==files.length || !files.length)return false;
    for(let i=0;i<files.length;i++) {
      const menu=list.children[i].querySelector('[id^="menu-"]');
      if(!menu || menu.id!=='menu-'+files[i].id)return false;
    }
    return true;
  }
  function paintKey(items) {
    try {
      const selected=window.multiSelectState?.selectedIds;
      const selectedIds=selected instanceof Set ? Array.from(selected).sort() : [];
      const scope=typeof currentFolderId!=='undefined'?currentFolderId:'';
      const category=typeof currentCategory!=='undefined'?currentCategory:'';
      const metadata=typeof appMeta!=='undefined'?appMeta:{};
      const itemsKey=items.map(i=>[
        i.id,i.type,i.name,i.mimeType||'',i.size||'',
        i.description||'',i.tempUrl||'',!!i.isPending,!!i.isGhostPaste,
        i.recentlyUploadedAt||0,
        metadata?.[i.id]?.name||'',metadata?.[i.id]?.desc||'',
        metadata?.[i.id]?.cover||'',metadata?.[i.id]?.type||'',
        metadata?.[i.id]?.pinnedAt||''
      ]);
      return JSON.stringify([scope,category,
        document.getElementById('fileList')?.classList.contains('list-view'),
        selectedIds,itemsKey]);
    }catch(_) {return '';}
  }
  // The legacy renderer forces names from Sheets metadata, even when Drive has changed.
  // Keep the current Drive name authoritative at render time without altering other metadata.
  function installRendererGuard() {
    const original = window.renderItems;
    if (typeof original !== 'function' || original === installedRenderer ||
        original.__vlStableUploadGuard) return;
    const wrapped = function(items, ...args) {
      if (Array.isArray(items)) items.forEach(item => {
        const liveName = driveNames.get(item.id);
        if (!liveName) return;
        item.name = liveName;
        try {
          if (typeof appMeta !== 'undefined' && appMeta[item.id]) appMeta[item.id].name = liveName;
        } catch (_) {}
      });
      // Search, active uploads, temporary cards, and folder-only views must
      // use the original renderer. Only suppress identical in-folder repaints.
      const files=Array.isArray(items)?items.filter(i=>i.type!=='folder'):[];
      const search=!!args[0];
      const key=!search && files.length && !files.some(i=>i.isPending||i.isGhostPaste||i.tempUrl)
        ?paintKey(items):'';
      if(key && key===lastPaintKey && sameFileCards(files))return undefined;
      const result=original.call(this, items, ...args);
      if(key && sameFileCards(files))lastPaintKey=key;
      else lastPaintKey='';
      return result;
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
    if (!force && (document.hidden || Date.now() - lastRun < 9000)) return false;
    if (new URLSearchParams(location.search).has('shareId')) return false;
    // The old loading overlay can stay mounted after login; do not block Drive reads.
    if ((!force && busy()) || !endpoint() || !activeFolder()) return false;
    return !!folderCache();
  }
  function cleanUploadState(item) {
    if (!item) return item;
    // Legacy renderItems checks tempUrl rather than isPending. Real IDs with
    // a tempUrl are finished uploads with an accidentally retained flag.
    if (String(item.id).startsWith('temp_file_') && item.isPending) return item;
    if (!item.tempUrl && !item.isPending) return item;
    const clean={...item};
    delete clean.tempUrl;
    delete clean.isPending;
    return clean;
  }
  function signature(items) {
    return JSON.stringify(items.map(item =>
      [item.id, item.type, item.name, item.mimeType || '',
       !!item.isPending, !!item.tempUrl]));
  }
  function mergePending(oldItems, freshItems) {
    const cleanedOld=oldItems.map(cleanUploadState);
    const cleanedFresh=freshItems.map(cleanUploadState);
    const liveIds=new Set(cleanedFresh.map(x=>x.id));
    const pending=cleanedOld.filter(item=>item && (
      item.isPending || (item.recentlyUploadedAt &&
        Date.now()-item.recentlyUploadedAt<120000)
    ));
    const byId=new Map(pending.map(item=>[item.id,item]));
    const merged=cleanedFresh.map(item=>byId.get(item.id) || item);

    // A second device may see the finished Drive file before this device
    // receives its upload acknowledgement. Only reconcile a fake ID with
    // a live file if its name+size and creation time reliably match.
    const active=window.vlActiveUploadIds;
    const nameCounts=new Map();
    for(const x of cleanedFresh)nameCounts.set(x.name,(nameCounts.get(x.name)||0)+1);
    for(const item of pending) {
      if(liveIds.has(item.id))continue;
      if(String(item.id).startsWith('temp_file_')) {
        if(active?.has(item.id)) {
          merged.push(item);
          continue;
        }
        const matches=cleanedFresh.filter(x=>x.type!=='folder'&&x.name===item.name&&
          (!item.mimeType||!x.mimeType||x.mimeType===item.mimeType)&&
          (!item.size||!x.size||Number(x.size)===Number(item.size)));
        const started=Number(item.uploadStartedAt ||
          String(item.id).match(/^temp_file_(?:vl_)?(\d{13})/)?.[1] || 0);
        if(matches.length===1 && nameCounts.get(item.name)===1 &&
           started && Date.now()-started<30*60000 &&
           matches[0].createdTime &&
           Math.abs(new Date(matches[0].createdTime).getTime()-started)<5*60000) {
          continue; // Proven equivalent real file, no ghost uploading card.
        }
        if(started && Date.now()-started>40*60000)continue; // Abandoned pending.
      }
      merged.push(item);
    }
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
        fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,webViewLink)',
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
          ...(!isFolder ? {mimeType:file.mimeType, size:file.size,
            createdTime:file.createdTime, url:file.webViewLink || ''} : {})
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
    let fromDrive = await liveList(id);
    // A pending batch on this browser and a completed file on another browser
    // require Drive creation timestamps to pair safely. Apps Script's list()
    // omits them, so request authoritative metadata only for this case.
    const cachedBefore=folderCache()?.[id] || [];
    const pendingNeedsReconcile = cachedBefore.some(item =>
      item?.isPending && String(item.id).startsWith('temp_file_') &&
      fromDrive.some(real => real.type!=='folder' && real.name===item.name) &&
      !fromDrive.some(real=>real.name===item.name && real.createdTime));
    if(pendingNeedsReconcile) {
      try { fromDrive=await directDriveList(id); }
      catch(err) { console.warn('[QL Ảnh] Chờ metadata đối chiếu file upload',err); }
    }
    window.vlVerifiedDeletions?.reconcileLiveList?.(fromDrive);
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
      // Recheck the active directory frequently. Its ancestors and expanded
      // mega-rows use a slower deep pass to avoid repeated Drive queries and
      // thumbnail re-renders across every connected device.
      const deep = force || Date.now() - lastDeepRun >= FULL_REFRESH_INTERVAL;
      if (deep) {
        for (const parent of path.slice(0, -1)) {
          try { liveParents.set(parent.id, await syncOne(parent.id)); }
          catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Không thể kiểm tra', parent.id, err); }
        }
        updatePathFromParents(path, liveParents);
      }
      if (activeFolder() === originalActive) {
        try { await syncOne(originalActive); }
        catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Đồng bộ Drive thất bại', err); }
      }
      // The root displays expanded mega-folder rows from a separate subfolder cache.
      if (deep && activeFolder() === originalActive && path.length === 1) {
        const opened = Array.from(document.querySelectorAll('[id^="acc-"]:not(.hidden)'))
          .map(element => element.id.slice(4)).filter(Boolean).slice(0, 12);
        for (const id of opened) {
          try { await syncOne(id); }
          catch (err) { allSucceeded = false; console.warn('[QL Ảnh] Không thể cập nhật thư mục con', id, err); }
        }
      }
      lastRun = Date.now();
      if (deep && allSucceeded) lastDeepRun = lastRun;
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
    // Revalidate a newly opened directory instead of waiting the background
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
    window.addEventListener('focus', () => {
      if (Date.now() - lastRun >= 5000) void refresh(true);
      // The legacy metadata watcher already polls every 5 seconds. Trigger
      // one immediate metadata check on focus without a page reload.
      try {
        if (typeof silentFetchMeta === 'function' &&
            document.getElementById('infoModal')?.classList.contains('hidden') &&
            !busy()) void silentFetchMeta();
      } catch (_) {}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.vinhlocLiveDriveSync = () => refresh(true);
})();