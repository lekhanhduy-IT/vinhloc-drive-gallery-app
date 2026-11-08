/* Lightweight two-layer login slideshow. Only the next photo is preloaded;
   authentication, Google button and the verification screen are untouched. */
(() => {
  'use strict';
  const overlay = document.getElementById('auth-overlay');
  const container = document.getElementById('vl-login-backgrounds');
  if (!overlay || !container) return;
  const layers = Array.from(container.querySelectorAll('.vl-login-bg'));
  if (layers.length !== 2) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const MANIFEST = '/login-backgrounds/backgrounds.json';
  const ROTATION_MS = 8500;
  let images = [];
  let pointer = 0;
  let activeLayer = 0;
  let hasPhoto = false;
  let loading = false;
  let timer = null;

  const visible = () => !document.hidden && !overlay.hidden &&
    getComputedStyle(overlay).display !== 'none';

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    stopTimer();
    if (!visible() || !images.length || reducedMotion.matches) return;
    timer = setTimeout(() => {
      timer = null;
      void showNext();
    }, ROTATION_MS);
  }
  function preload(src) {
    return new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
    });
  }
  async function showNext() {
    if (loading || !visible() || !images.length) return;
    loading = true;
    let success = false;
    try {
      const attempts = images.length;
      for (let i = 0; i < attempts; i++) {
        const src = images[pointer++ % images.length];
        if (!(await preload(src))) continue;
        if (!visible()) return;
        const next = hasPhoto ? 1 - activeLayer : activeLayer;
        layers[next].style.backgroundImage = 'url(' + JSON.stringify(src) + ')';
        // Switch only after the image is decoded/loaded, with no blank frame.
        layers[next].classList.add('is-visible');
        if (hasPhoto) layers[activeLayer].classList.remove('is-visible');
        activeLayer = next;
        hasPhoto = true;
        success = true;
        break;
      }
    } finally {
      loading = false;
      if (!success && visible()) images = []; // All broken: keep a clean white fallback.
      schedule();
    }
  }
  function syncVisibility() {
    if (!visible()) {
      stopTimer();
      return;
    }
    if (loading || !images.length) return;
    if (!hasPhoto) void showNext();
    else if (timer === null) schedule();
  }
  function shuffle(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }
  // Pausing while hidden prevents image loading and compositing after sign-in.
  new MutationObserver(syncVisibility).observe(overlay, {
    attributes: true, attributeFilter: ['style', 'class', 'hidden']
  });
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('pageshow', syncVisibility);
  reducedMotion.addEventListener?.('change', syncVisibility);

  fetch(MANIFEST, { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error('Login background manifest unavailable');
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data.images)) return;
      const sources = data.images.map(entry => entry && entry.src).filter(src => {
        if (typeof src !== 'string' || !src.startsWith('/login-backgrounds/')) return false;
        try {
          const url = new URL(src, location.origin);
          return url.origin === location.origin &&
            url.pathname.startsWith('/login-backgrounds/') &&
            /\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname);
        } catch { return false; }
      });
      images = shuffle([...new Set(sources)]);
      syncVisibility();
    })
    .catch(() => { /* Offline/unavailable: retain the white login background. */ });
})();
