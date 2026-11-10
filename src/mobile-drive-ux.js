/* VinhLoc mobile action sheet + decoded thumbnail continuity.
   Keep original action elements (and their permission handlers) intact. */
(() => {
  'use strict';
  if (window.__vlMobileDriveUX) return;
  window.__vlMobileDriveUX = true;
  const mobile = () => window.matchMedia('(max-width: 767px)').matches;
  const ID = /^[A-Za-z0-9_-]{10,180}$/;
  const style = document.createElement('style');
  style.textContent = `
    @media(max-width:767px){
      #fileList.vl-pinterest:not(.list-view)>div{min-width:0!important;contain:layout style;}
      #fileList.vl-pinterest:not(.list-view)>div>.h-32{
        position:relative!important;display:block!important;flex:none!important;
        width:100%!important;height:auto!important;min-height:0!important;
        max-height:none!important;aspect-ratio:4 / 5!important;
        overflow:hidden!important;background:#f1f5f9!important;
        margin-bottom:10px!important;
      }
      #fileList.vl-pinterest:not(.list-view)>div>.h-32>img.drive-img-item,
      #fileList.vl-pinterest:not(.list-view)>div>.h-32>img,
      #fileList.vl-pinterest:not(.list-view)>div>.h-32>video{
        position:absolute!important;inset:0!important;display:block!important;
        width:100%!important;height:100%!important;min-height:0!important;
        max-height:none!important;aspect-ratio:auto!important;
        object-fit:contain!important;object-position:center!important;
      }
      #fileList.vl-pinterest:not(.list-view)>div:not(:has(>.h-32)):has([id^="menu-"])::before{
        content:"";display:block;flex:none;width:100%;aspect-ratio:4 / 5;
        border-radius:10px;background:#f1f5f9;margin-bottom:10px;
      }
      #fileList.vl-pinterest:not(.list-view)>div .drive-img-name{overflow-wrap:anywhere;}
      #folderList img,.mega-header img,.subfolder-row img{object-fit:cover;}
    }
    #vlDriveSheetLayer{position:fixed;inset:0;z-index:2147482000;visibility:hidden;pointer-events:none;}
    #vlDriveSheetLayer.open{visibility:visible;pointer-events:auto;}
    #vlDriveSheetDim{position:absolute;inset:0;background:rgba(0,0,0,.42);opacity:0;transition:opacity .23s;}
    #vlDriveSheetLayer.open #vlDriveSheetDim{opacity:1;}
    #vlDriveSheet{position:absolute;left:0;right:0;bottom:0;max-height:85dvh;
      display:flex;flex-direction:column;overflow:hidden;border-radius:24px 24px 0 0;
      background:#fff;box-shadow:0 -12px 35px #0003;
      padding-bottom:max(14px,env(safe-area-inset-bottom));
      transform:translate3d(0,105%,0);
      transition:transform .26s cubic-bezier(.2,.8,.2,1);isolation:isolate;}
    #vlDriveSheetLayer.open #vlDriveSheet{transform:translate3d(0,0,0);}
    #vlSheetGrip{width:38px;height:5px;flex:none;border-radius:6px;background:#cbd5e1;align-self:center;margin:10px 0;}
    #vlSheetHeading{display:flex;align-items:center;gap:12px;flex:none;padding:6px 17px 12px;border-bottom:1px solid #e5e7eb;}
    #vlSheetTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;color:#1f2937;font:650 16px system-ui;}
    #vlSheetClose{
      appearance:none!important;box-sizing:border-box!important;display:flex!important;
      align-items:center!important;justify-content:center!important;
      flex:0 0 42px!important;width:42px!important;height:42px!important;
      min-width:42px!important;min-height:42px!important;
      margin:0!important;padding:0!important;line-height:0!important;
      border:0!important;border-radius:50%!important;background:#fff1f2!important;
      color:#db1010!important;cursor:pointer!important;touch-action:manipulation;
      transform:none!important;position:relative;z-index:10;
    }
    #vlSheetClose svg{display:block;width:22px;height:22px;pointer-events:none;}
    #vlSheetActions{overflow-y:auto;overscroll-behavior:contain;padding:6px 14px 10px;min-height:0;}
    #vlSheetActions>.item-action-menu,#vlSheetActions>#headerDropdown{
      display:block!important;position:static!important;inset:auto!important;
      transform:none!important;width:100%!important;min-width:0!important;
      max-width:none!important;max-height:none!important;overflow:visible!important;
      box-shadow:none!important;border:0!important;border-radius:0!important;
      background:transparent!important;margin:0!important;opacity:1!important;
      visibility:visible!important;
    }
    #vlSheetActions :is(button,a,[role="menuitem"]){
      box-sizing:border-box;min-height:46px;cursor:pointer;touch-action:manipulation;
    }
    #vlSheetActions .vl-sheet-empty{padding:18px 12px;color:#64748b;
      font:500 14px/1.55 system-ui;text-align:center;}
    @media(prefers-reduced-motion:reduce){
      #vlDriveSheet,#vlDriveSheetDim{transition:none!important;}
    }
  `;
  document.head.appendChild(style);

  const layer = document.createElement('div');
  layer.id = 'vlDriveSheetLayer';
  layer.innerHTML =
    '<div id="vlDriveSheetDim"></div>' +
    '<section id="vlDriveSheet" role="dialog" aria-modal="true" aria-labelledby="vlSheetTitle">' +
      '<div id="vlSheetGrip"></div><div id="vlSheetHeading">' +
      '<span id="vlSheetTitle"></span><button id="vlSheetClose" type="button" aria-label="Đóng menu">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M5 5L19 19M19 5L5 19"></path></svg></button></div>' +
      '<div id="vlSheetActions"></div></section>';
  document.body.appendChild(layer);
  const slot = layer.querySelector('#vlSheetActions');
  const title = layer.querySelector('#vlSheetTitle');
  const closeButton = layer.querySelector('#vlSheetClose');
  let active = null, placeholder = null, trigger = null, timer = 0, lastTrigger = null;
  const currentFolder = () => {
    try { return typeof currentFolderId !== 'undefined' ? currentFolderId : window.currentFolderId; }
    catch (_) { return window.currentFolderId; }
  };
  function cacheList() {
    try { return typeof currentDriveItems !== 'undefined' ? currentDriveItems : window.currentDriveItems; }
    catch (_) { return window.currentDriveItems; }
  }
  function meta() {
    try { return typeof appMeta !== 'undefined' ? appMeta : window.appMeta; }
    catch (_) { return window.appMeta; }
  }
  function scopeKey() {
    const shared = window.vlShareScope;
    if (shared) return 'shared:' + String(shared.root || '') + ':' + String(shared.ready?.() || false);
    return 'account:' + (localStorage.getItem('vinhloc_authenticated_email') || '') + ':' +
      String(document.body.dataset.vlAccountRole || '');
  }
  const escapeId = id => window.CSS?.escape ? CSS.escape(id) : id.replace(/[^\w-]/g, '');
  function labelFor(id, menu, button) {
    const row = menu.closest('.mega-row,.subfolder-row,.mega-header,#fileList > div,#folderList > div') ||
      button?.closest('.mega-row,.subfolder-row,.mega-header,#fileList > div,#folderList > div');
    const node = row?.querySelector('.item-name-' + escapeId(id)) ||
      row?.querySelector('.drive-img-name,[class*="item-name-"]') ||
      document.querySelector('#folderList .item-name-' + escapeId(id)) ||
      document.querySelector('#fileList .item-name-' + escapeId(id));
    const name = node?.textContent?.trim() ||
      cacheList()?.find?.(item => item.id === id)?.name ||
      meta()?.[id]?.name ||
      row?.querySelector('.font-bold,.font-semibold')?.textContent?.trim();
    return name || 'Mục đã chọn';
  }
  function restore() {
    if (!active) return;
    const node = active, marker = placeholder;
    active = null; placeholder = null;
    if (node.isConnected && marker?.parentNode) marker.replaceWith(node);
    else if (node.isConnected) node.remove();
    else marker?.remove();
    node.classList.add('hidden');
    node.style.removeProperty('display');
    node.style.removeProperty('max-height');
    node.style.removeProperty('overflow-y');
    node.style.removeProperty('width');
    slot.replaceChildren();
  }
  function close(immediate = false) {
    if (!active && !layer.classList.contains('open')) return;
    layer.classList.remove('open');
    document.body.classList.remove('vl-sheet-open');
    clearTimeout(timer);
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) restore();
    else timer = setTimeout(restore, 280);
    if (trigger?.isConnected) {
      try { trigger.focus({preventScroll:true}); } catch (_) {}
    }
    trigger = null;
  }
  closeButton.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation(); close();
  }, true);
  layer.querySelector('#vlDriveSheetDim').addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation(); close();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && layer.classList.contains('open')) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  }, true);
  slot.addEventListener('click', e => {
    if (e.target.closest('button,a,[onclick],[data-vl-owned],[data-vl-owner-action]')) {
      setTimeout(() => close(), 0);
    }
  });
  document.addEventListener('click', e => {
    if (active && e.target.closest('#btnBack,.subfolder-row,.mega-header,[onclick*="loadFolder"]')) close(true);
  }, true);

  function showEmpty(menu, id, isHeader = false) {
    menu.querySelector('.vl-sheet-empty')?.remove();
    menu.querySelector('.vl-sheet-fallback')?.remove();
    // Reuse existing owner/admin controls whenever any usable row exists.
    // Restricted (display:none) mutations must never become visible.
    const visible = [...menu.querySelectorAll('button,a,[onclick],[role="menuitem"]')]
      .some(el => !el.disabled && !el.classList.contains('hidden') &&
        getComputedStyle(el).display !== 'none' &&
        getComputedStyle(el).visibility !== 'hidden' &&
        el.getClientRects().length > 0 &&
        !el.closest('[hidden],.hidden'));
    if (visible) return;

    // Some shared-drive accounts have no native actions at all. Supply only
    // non-mutating read actions; never manufacture edit/delete/share rights.
    const share = window.vlShareScope;
    const authenticated = share ? share.ready?.() === true :
      !!localStorage.getItem('vinhloc_authenticated_email');
    const item = cacheList()?.find?.(entry => entry.id === id);
    const type = item?.type === 'folder' || isHeader ? 'folder' : 'file';
    const targetId = isHeader && share ? share.root : id;
    const targetName = isHeader ? title.textContent : title.textContent;
    const actions = document.createElement('div');
    actions.className = 'vl-sheet-fallback vinhloc-safe-item';
    actions.style.cssText = 'display:flex!important;flex-direction:column!important;width:100%;padding:4px;';
    const add = (label, icon, run) => {
      const button = document.createElement('button');
      button.type='button';
      button.className='vinhloc-safe-item';
      button.style.cssText = 'display:flex!important;align-items:center;gap:14px;width:100%;min-height:48px;padding:11px 14px;text-align:left;color:#374151;font:600 15px system-ui;';
      const glyph = document.createElement('i');
      glyph.className=icon;
      glyph.style.cssText='width:21px;text-align:center;color:#01adee;';
      const text=document.createElement('span');
      text.textContent=label;
      button.append(glyph,text);
      button.addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        close();
        run(e);
      });
      actions.appendChild(button);
    };
    if (authenticated && ID.test(targetId)) {
      if (!isHeader && typeof window.downloadItem === 'function') {
        add('Tải xuống','fas fa-download', e =>
          window.downloadItem(targetId,type,targetName,e));
      }
      add('Sao chép đường dẫn Drive','fas fa-link', async () => {
        const url=type==='folder' ?
          'https://drive.google.com/drive/folders/'+encodeURIComponent(targetId) :
          'https://drive.google.com/file/d/'+encodeURIComponent(targetId)+'/view';
        try {
          await navigator.clipboard.writeText(url);
          window.showToast?.('Đã sao chép đường dẫn Drive');
        } catch (_) {
          // A denied clipboard permission should not create a fake success.
          window.showToast?.('Trình duyệt chưa cho phép sao chép đường dẫn',true);
        }
      });
    }
    if(actions.childElementCount) menu.appendChild(actions);
    else {
      const message=document.createElement('p');
      message.className='vl-sheet-empty';
      message.textContent=authenticated ? 'Không có thao tác khả dụng với mục này.' :
        'Cần xác thực tài khoản để xem các thao tác được cấp quyền.';
      menu.appendChild(message);
    }
  }
  function open(menu, id, source, isHeader = false) {
    if (!mobile() || !menu || !menu.parentNode) return;
    clearTimeout(timer);
    if (active) restore();
    const displayName = isHeader
      ? (window.vlShareScope ? (window.vlShareScope.name || 'Bộ nhớ dùng chung') :
         (String(currentFolder() || '') ? 'Tùy chọn ' + (document.getElementById('currentFolderName')?.textContent?.trim() || 'thư mục') : 'Tùy chọn'))
      : labelFor(id, menu, source);
    trigger = source || lastTrigger || document.activeElement;
    placeholder = document.createComment('Original action menu slot');
    menu.parentNode.insertBefore(placeholder, menu);
    active = menu; // Important: close() must know which menu to restore.
    slot.replaceChildren(menu);
    menu.classList.remove('hidden');
    menu.style.setProperty('display', 'block', 'important');
    title.textContent = displayName.slice(0, 150);
    layer.classList.add('open');
    document.body.classList.add('vl-sheet-open');
    showEmpty(menu, id, isHeader);
  }
  // Capture the clicked element before the protected legacy handlers run.
  document.addEventListener('pointerdown', e => {
    const button = e.target.closest?.('[onclick*="toggleItemMenu"],[onclick*="toggleHeaderMenu"]');
    if (button) lastTrigger = button;
  }, true);
  window.vlMenuController?.onItem?.(({id, menu}) => {
    if (mobile()) open(menu, id, lastTrigger);
  });
  window.vlMenuController?.onHeader?.(({menu}) => {
    if (mobile()) open(menu, 'header', lastTrigger ||
      document.querySelector('#headerDropdownContainer > button'), true);
  });
  // Legacy toggles can be triggered without the coordinator. Guard only
  // the fallback path, so a single tap never opens the sheet twice.
  document.addEventListener('click', e => {
    if (!mobile()) return;
    const button = e.target.closest?.('[onclick*="toggleItemMenu"]');
    if (!button || layer.classList.contains('open')) return;
    const inline = button.getAttribute('onclick') || '';
    const id = inline.match(/toggleItemMenu\(\s*['"]([^'"]+)/)?.[1];
    setTimeout(() => {
      const menu = id ? document.getElementById('menu-' + id) : null;
      if (menu && !menu.classList.contains('hidden') && !active) open(menu, id, button);
    }, 0);
  }, true);
  window.addEventListener('resize', () => { if (!mobile()) close(true); }, {passive:true});

  // An already-decoded IMG remains decoded when the exact DOM image element
  // is reinserted. Only hold a bounded RAM LRU, never store private pixels or
  // tokens in LocalStorage, IndexedDB or a public Service Worker cache.
  const decoded = new Map();
  const MAX_IMAGES = 180;
  let identity = scopeKey();
  function imageKey(img) {
    if (!img || !img.matches('img')) return '';
    if (!img.closest('#fileList,#folderList,.mega-row,.mega-header,.subfolder-row') &&
        !img.classList.contains('drive-img-item') &&
        ![...img.classList].some(name => name.startsWith('item-cover-img-'))) return '';
    for (const cls of img.classList) {
      if (cls.startsWith('item-cover-img-')) {
        const id = cls.slice('item-cover-img-'.length);
        if (ID.test(id)) return 'cover:' + id;
      }
    }
    let row = img.closest('.subfolder-row,.mega-row,.mega-header,#fileList > div,#folderList > div');
    // Disconnected file cards lose their #fileList parent. Walk upwards to
    // the nearest card with the immutable item-name/menu id.
    if (!row) {
      for (let cursor=img.parentElement, depth=0; cursor && depth<7; cursor=cursor.parentElement,depth++) {
        if (cursor.querySelector('[id^="menu-"],[class*="item-name-"]')) { row=cursor; break; }
      }
    }
    const id = row?.querySelector('.item-action-menu[id^="menu-"]')?.id?.slice(5) ||
      row?.querySelector('[class*="item-name-"]')?.className?.match(/item-name-([\w-]{10,180})/)?.[1] || '';
    if (ID.test(id)) return img.classList.contains('drive-img-item') || !!row.closest('#fileList')
      ? 'file:' + id : 'folder:' + id;
    try {
      const url = new URL(img.getAttribute('src') || '', location.href);
      const key = url.searchParams.get('fileId') || url.searchParams.get('id');
      if (ID.test(key || '')) return 'image:' + key;
    } catch (_) {}
    return '';
  }
  function rememberRemoved(node) {
    if (node.nodeType !== 1) return;
    const imgs = node.matches?.('img') ? [node] : [...node.querySelectorAll('img')];
    for (const img of imgs) {
      if (img.isConnected || !img.complete || img.naturalWidth <= 0) continue;
      const key = imageKey(img);
      if (!key) continue;
      decoded.delete(key);
      decoded.set(key, img);
      if (decoded.size > MAX_IMAGES) decoded.delete(decoded.keys().next().value);
    }
  }
  function restoreAdded(node) {
    if (node.nodeType !== 1) return;
    const imgs = node.matches?.('img') ? [node] : [...node.querySelectorAll('img')];
    for (const img of imgs) {
      if (!img.isConnected) continue;
      const key = imageKey(img);
      const previous = decoded.get(key);
      if (!key || !previous || previous === img || previous.isConnected ||
          !previous.complete || !previous.naturalWidth) continue;
      // Do not resurrect a different Drive cover or a different video frame.
      const oldURL = previous.getAttribute('src') || '';
      const newURL = img.getAttribute('src') || '';
      const coverSource = url => {
        try { const u = new URL(url, location.href); return u.searchParams.get('fileId') || u.searchParams.get('id') || ''; }
        catch (_) { return ''; }
      };
      if (key.startsWith('cover:') && coverSource(oldURL) && coverSource(newURL) &&
          coverSource(oldURL) !== coverSource(newURL)) continue;
      decoded.delete(key);
      img.replaceWith(previous);
    }
  }
  const observer = new MutationObserver(records => {
    const next = scopeKey();
    if (next !== identity) { decoded.clear(); identity = next; return; }
    // Collect detached pixels before attempting to attach fresh cards.
    for (const rec of records) for (const node of rec.removedNodes) rememberRemoved(node);
    for (const rec of records) for (const node of rec.addedNodes) restoreAdded(node);
  });
  for (const id of ['folderList','fileList']) {
    const el = document.getElementById(id);
    if (el) observer.observe(el, {childList:true,subtree:true});
  }
  window.addEventListener('vl:media-authorized', () => { decoded.clear(); identity = scopeKey(); });
  window.addEventListener('vl:share-member-ready', () => { decoded.clear(); identity = scopeKey(); });
  window.addEventListener('storage', e => {
    if (e.key === 'vinhloc_authenticated_email') { decoded.clear(); identity = scopeKey(); }
  });
  // Avoid keeping decoded images from an old account after an in-tab logout.
  setInterval(() => {
    const next = scopeKey();
    if (next !== identity) { decoded.clear(); identity = next; }
  }, 2000);
})();