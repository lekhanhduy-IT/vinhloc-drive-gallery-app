/* Progressive login slideshow: the first <img> already has a real src in HTML.
 * If manifest fetch or JavaScript fails, the login background still appears.
 * This is a Vite module entry in index.html so Vercel includes it in the build. */
(() => {
  'use strict';
  const overlay = document.getElementById('auth-overlay');
  const container = document.getElementById('vl-login-backgrounds');
  if (!overlay || !container) return;
  const layers = Array.from(container.querySelectorAll('img.vl-login-bg'));
  if (layers.length !== 2) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ROTATION_MS = 8500;
  let photos = [];
  let pointer = 0;
  let current = 0;
  let loading = false;
  let timer = null;

  function loginVisible() {
    return !document.hidden && !overlay.hidden &&
      getComputedStyle(overlay).display !== 'none';
  }
  function pause() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function nextTimer() {
    pause();
    if (!loginVisible() || reduceMotion.matches || !photos.length) return;
    timer = setTimeout(() => {
      timer = null;
      void rotate();
    }, ROTATION_MS);
  }
  function load(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }
  async function rotate() {
    if (loading || !loginVisible() || !photos.length) return;
    loading = true;
    let loaded = false;
    try {
      for (let attempt = 0; attempt < photos.length; attempt++) {
        const src = photos[pointer++ % photos.length];
        if (layers[current].getAttribute('src') === src) continue;
        if (!await load(src)) continue;
        if (!loginVisible()) return;
        const other = 1 - current;
        layers[other].src = src;
        layers[other].classList.add('is-visible');
        layers[current].classList.remove('is-visible');
        current = other;
        loaded = true;
        break;
      }
    } finally {
      loading = false;
      if (!loaded && loginVisible()) photos = [];
      nextTimer();
    }
  }
  function onVisibility() {
    if (!loginVisible()) { pause(); return; }
    if (timer === null && !loading) nextTimer();
  }
  new MutationObserver(onVisibility).observe(overlay, {
    attributes: true, attributeFilter: ['style','class','hidden']
  });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
  reduceMotion.addEventListener?.('change', onVisibility);

  fetch('/login-backgrounds/backgrounds.json', {cache: 'no-store'})
    .then(response => {
      if (!response.ok) throw new Error('Cannot load background manifest');
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data.images)) return;
      photos = [...new Set(data.images
        .map(entry => entry?.src)
        .filter(src => typeof src === 'string' &&
          src.startsWith('/login-backgrounds/') &&
          /\.(png|jpe?g|webp|avif)$/i.test(src)))];
      for (let i=photos.length-1; i>0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [photos[i], photos[j]] = [photos[j], photos[i]];
      }
      nextTimer();
    })
    .catch(error => {
      console.warn('[login backgrounds] Slideshow unavailable; showing static first photo.', error);
    });
})();
