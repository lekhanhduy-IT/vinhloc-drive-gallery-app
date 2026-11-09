/* Match the animated loading GIF width to the heading's actual text width.
   ResizeObserver handles font rendering, orientation and device font scaling. */
(() => {
  'use strict';
  const title = document.getElementById('vl-login-title');
  const gif = document.getElementById('vl-login-animation');
  const panel = document.querySelector('#auth-overlay .vl-login-panel');
  if (!title || !gif || !panel) return;
  let last = 0;
  function syncWidth() {
    const range = document.createRange();
    range.selectNodeContents(title);
    const measured = range.getBoundingClientRect().width;
    range.detach?.();
    if (!(measured > 0)) return;
    const width = Math.round(Math.min(measured, panel.clientWidth - 8));
    if (width === last || width <= 0) return;
    last = width;
    gif.style.setProperty('--vl-login-heading-width', width + 'px');
  }
  syncWidth();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(syncWidth);
    observer.observe(title);
    observer.observe(panel);
  } else {
    window.addEventListener('resize', syncWidth);
  }
  document.fonts?.ready?.then(syncWidth).catch(() => {});
})();
