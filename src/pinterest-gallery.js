/* Responsive QL Anh file gallery.
   Desktop: square grid, eight default columns, unlimited +/- steps without
   scaling the metadata labels or the three-dot action controls.
   Mobile/tablet: original-aspect Pinterest masonry.
   Folder rows, selection handlers, upload cards and list-view stay intact. */
(() => {
  'use strict';
  if (window.__vlPinterestGallery) return;
  const grid = document.getElementById('fileList');
  if (!grid) return;
  window.__vlPinterestGallery = true;

  const desktopQuery = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
  const isDesktop = () => desktopQuery.matches;
  const desktopKey = 'vl_desktop_square_columns_v1';
  const defaultDesktopColumns = 8;
  const readDesktopColumns = () => {
    try {
      const n = Number(localStorage.getItem(desktopKey));
      return Number.isSafeInteger(n) && n >= 1 ? n : defaultDesktopColumns;
    } catch (_) { return defaultDesktopColumns; }
  };
  const mobileClamp = n => Math.max(2, Math.min(6, Math.round(n)));
  const mobileDefault = () => window.innerWidth >= 720 ? 4 :
    window.innerWidth >= 520 ? 3 : 2;
  const legacyStored = () => {
    try { return Number(localStorage.getItem('vinhloc_grid_cols') || 0); }
    catch (_) { return 0; }
  };
  const parseLegacyColumns = () => {
    const match = (grid.style.gridTemplateColumns || '').match(/repeat\(\s*(\d+)\s*,/i);
    return match ? mobileClamp(Number(match[1])) : 0;
  };

  let desktopColumns = readDesktopColumns();
  let mobileColumns = legacyStored() > 2
    ? mobileClamp(legacyStored()) : mobileDefault();
  let customizedMobile = false;
  let lastInlineColumns = grid.style.gridTemplateColumns;

  function setMobileColumns(n) {
    mobileColumns = mobileClamp(n);
    if (grid.style.getPropertyValue('--vl-pinterest-columns').trim() !== String(mobileColumns))
      grid.style.setProperty('--vl-pinterest-columns', String(mobileColumns));
  }
  function setDesktopColumns(n) {
    const next = Math.floor(n);
    if (!Number.isSafeInteger(next) || next < 1 || next === desktopColumns) return;
    desktopColumns = next;
    try { localStorage.setItem(desktopKey, String(next)); } catch (_) {}
    grid.style.setProperty('--vl-desktop-columns', String(next));
  }
  function applyResponsiveMode() {
    const desktop = isDesktop();
    grid.classList.toggle('vl-desktop-squares', desktop);
    grid.classList.toggle('vl-pinterest', !desktop);
    if (desktop) {
      grid.style.setProperty('--vl-desktop-columns', String(desktopColumns));
    } else {
      if (!customizedMobile) {
        const saved = legacyStored();
        mobileColumns = saved > 2 ? mobileClamp(saved) : mobileDefault();
      }
      setMobileColumns(mobileColumns);
    }
  }
  function syncLegacyZoom() {
    const inline = grid.style.gridTemplateColumns;
    if (inline === lastInlineColumns) return;
    lastInlineColumns = inline;
    // The obfuscated legacy grid still writes an inline 2..6-column layout.
    // Never allow it to replace desktop's independent 8+ column preference.
    if (isDesktop()) return;
    const parsed = parseLegacyColumns();
    if (parsed) { customizedMobile = true; setMobileColumns(parsed); }
  }

  const ratioById = new Map();
  const observedImages = new WeakSet();
  function fileId(img) {
    let card = img;
    while (card && card.parentElement !== grid) card = card.parentElement;
    if (!card) return '';
    const marker = card.querySelector('[id^="menu-"]');
    return marker?.id?.slice(5) || '';
  }
  function remember(img) {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const id = fileId(img);
    if (!id) return;
    const width = img.naturalWidth, height = img.naturalHeight;
    ratioById.set(id, {width, height});
    if (img.getAttribute('width') !== String(width))
      img.setAttribute('width', String(width));
    if (img.getAttribute('height') !== String(height))
      img.setAttribute('height', String(height));
  }
  function scan() {
    if (!grid.isConnected) return;
    for (const img of grid.querySelectorAll('img.drive-img-item')) {
      if (observedImages.has(img)) continue;
      observedImages.add(img);
      const id = fileId(img), ratio = ratioById.get(id);
      if (ratio) {
        img.setAttribute('width', ratio.width);
        img.setAttribute('height', ratio.height);
      }
      img.addEventListener('load', () => remember(img));
      if (img.complete && img.naturalWidth) remember(img);
    }
  }

  // Set desktop mode immediately: prevent a flash of mobile masonry.
  applyResponsiveMode();
  function init() {
    lastInlineColumns = grid.style.gridTemplateColumns;
    applyResponsiveMode();
    scan();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();

  let scheduled = false;
  const observer = new MutationObserver(mutations => {
    const inlineChanged = mutations.some(m =>
      m.type === 'attributes' && m.target === grid && m.attributeName === 'style');
    if (inlineChanged) syncLegacyZoom();
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; scan(); });
    }
  });
  observer.observe(grid, {
    childList:true, subtree:true, attributes:true,
    attributeFilter:['style', 'src', 'class']
  });

  window.addEventListener('resize', applyResponsiveMode, {passive:true});
  desktopQuery.addEventListener?.('change', applyResponsiveMode);

  function editableOrModal(target) {
    if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
      return true;
    for (const id of ['infoModal', 'infoFolderImagePicker', 'input-overlay',
      'watermark-overlay-container', 'auth-overlay', 'vlAuthWait']) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden') || el.hasAttribute('hidden')) continue;
      if (getComputedStyle(el).display !== 'none' && el.getClientRects().length) return true;
    }
    return false;
  }
  function canAdjust(target) {
    return isDesktop() && !grid.classList.contains('list-view') &&
      grid.children.length > 0 && grid.getClientRects().length > 0 &&
      !editableOrModal(target);
  }
  // Ctrl + / Ctrl - control only the tile size, not browser font or app buttons.
  // Every press changes one column; no 6/8/12-column ceiling.
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !canAdjust(event.target)) return;
    const plus = event.code === 'Equal' || event.code === 'NumpadAdd' ||
      event.key === '+' || event.key === '=';
    const minus = event.code === 'Minus' || event.code === 'NumpadSubtract' ||
      event.key === '-' || event.key === '_';
    const reset = event.code === 'Digit0' || event.code === 'Numpad0';
    if (!plus && !minus && !reset) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setDesktopColumns(reset ? defaultDesktopColumns :
      desktopColumns + (minus ? 1 : -1));
  }, true);

  // Ctrl + mouse wheel / trackpad over the file gallery also adjusts density.
  let lastWheel = 0;
  grid.addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey) || !canAdjust(event.target)) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) < 3) return;
    const now = performance.now();
    if (now - lastWheel < 110) return;
    lastWheel = now;
    setDesktopColumns(desktopColumns + (event.deltaY > 0 ? 1 : -1));
  }, {passive:false});

  window.vlPinterestGallery = {
    refresh:scan,
    columns:() => isDesktop() ? desktopColumns : mobileColumns,
    setColumns:n => isDesktop() ? setDesktopColumns(n) : setMobileColumns(n)
  };
})();