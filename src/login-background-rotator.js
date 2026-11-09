/* Random login photo sessions with stable first paint and strict 8.5s pacing.
 * Auto-generated bootstrap chooses the first photo before HTML is painted.
 * During signed-in time, one random next opening photo is preloaded.
 * Never replace the visible photo repeatedly during startup or logout. */
(() => {
  'use strict';
  if (window.__vlStableLoginWallpaperInstalled) return;
  const overlay = document.getElementById('auth-overlay');
  const layer = document.getElementById('vl-login-backgrounds');
  if (!overlay || !layer) return;
  window.__vlStableLoginWallpaperInstalled = true;

  const INTERVAL = 8500;
  const FADE = 1150;
  const TIMEOUT = 4200;
  const remoteBases = [
    'https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public',
    'https://cdn.jsdelivr.net/gh/lekhanhduy-IT/vinhloc-drive-gallery-app@main/public'
  ];
  const boot = window.__vlLoginBackgroundBoot || {};
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  // Built-in fallback is replaced by auto-generated bootstrap on normal builds.
  const defaultSources = ["/login-backgrounds/316e9496-bd61-457c-a431-37259a524b75.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_37%209%20thg%2011%2C%202026-1.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-2.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-3.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_39%209%20thg%2011%2C%202026-4.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-5.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-6.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_41%209%20thg%2011%2C%202026-7.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_42%209%20thg%2011%2C%202026-8.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-9.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-10.png"];
  let photos = [...new Set(boot.images?.length ? boot.images : defaultSources)];
  let current = boot.initial || photos[0] || '';
  let order = Array.isArray(boot.order) ? boot.order.filter(x => x !== current) : shuffled(photos.filter(x => x !== current));
  let index = 0;
  let visible = false;
  let started = false;
  let busy = false;
  let generation = 0;
  let timer = null;
  let due = Date.now() + INTERVAL;
  let preloaded = null;
  let prepareId = 0;

  function shuffled(items) {
    const output = items.slice();
    for (let n = output.length - 1; n > 0; n--) {
      const j = Math.floor(Math.random() * (n + 1));
      [output[n], output[j]] = [output[j], output[n]];
    }
    return output;
  }
  function canonical(src) {
    try {
      const path = new URL(src, location.href).pathname;
      const pos = path.indexOf('/login-backgrounds/');
      return pos >= 0 ? path.slice(pos) : path;
    } catch (_) { return String(src || ''); }
  }
  function resetOrder() {
    order = shuffled(photos.filter(src => canonical(src) !== canonical(current)));
    index = 0;
  }
  function randomReentryPhoto() {
    const options = photos.filter(src => canonical(src) !== canonical(current));
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }
  function isShown() {
    if (document.hidden || overlay.hidden || overlay.classList.contains('hidden')) return false;
    const style = getComputedStyle(overlay);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function nextTimer() {
    if (!visible || busy || timer !== null || photos.length < 2) return;
    const token = generation;
    timer = setTimeout(() => {
      timer = null;
      if (visible && token === generation) void changeOne(token);
    }, Math.max(0, due - Date.now()));
  }
  function probe(src) {
    return new Promise(resolve => {
      const image = new Image();
      let done = false;
      const timeout = setTimeout(() => finish(false), TIMEOUT);
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(ok);
      }
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = src;
    });
  }
  async function usable(src) {
    if (!src) return null;
    for (const candidate of [src, ...remoteBases.map(root => root + src)]) {
      if (await probe(candidate)) return candidate;
    }
    return null;
  }
  function paint(src,url) {
    overlay.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
    current = src;
  }
  function hideFade() {
    layer.style.transition = 'none';
    layer.classList.remove('is-visible');
    void layer.offsetWidth;
    layer.style.transition = '';
  }
  async function prepareReturn() {
    // Keep a decoded random photo ready before the next sign-out.
    if (preloaded && canonical(preloaded.src) !== canonical(current)) return;
    const id = ++prepareId;
    preloaded = null;
    const src = randomReentryPhoto();
    if (!src) return;
    const url = await usable(src);
    if (id !== prepareId) return;
    if (url) preloaded = {src,url};
  }
  function onVisibility() {
    const nowVisible = isShown();
    if (nowVisible === visible) return;
    visible = nowVisible;
    generation++;
    clearTimer();
    hideFade();
    if (!visible) {
      if (!preloaded || canonical(preloaded.src) === canonical(current))
        void prepareReturn();
      return;
    }
    if (started) {
      // Already-preloaded photo is painted once at session entry. If no
      // decoded photo is ready, keep the existing image rather than flash
      // an old image followed by a suddenly loaded random replacement.
      const ready = preloaded;
      if (ready && canonical(ready.src) !== canonical(current)) paint(ready.src,ready.url);
      preloaded = null;
      ++prepareId;
      resetOrder();
      void prepareReturn(); // Preload next randomized login photo.
    } else {
      started = true;  // Initial random photo was painted by bootstrap.js
    }
    due = Date.now() + INTERVAL;
    nextTimer();
  }
  async function changeOne(token) {
    if (busy || !visible || generation !== token || Date.now() < due) {
      nextTimer();
      return;
    }
    busy = true;
    try {
      if (index >= order.length) resetOrder();
      const src = order[index++];
      if (!src) return;
      const url = await usable(src);
      if (!url || !visible || token !== generation) return;
      if (reduced?.matches) {
        paint(src,url);
      } else {
        layer.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
        void layer.offsetWidth;
        if (!visible || token !== generation) return;
        layer.classList.add('is-visible');
        await new Promise(resolve => setTimeout(resolve,FADE));
        if (!visible || token !== generation) return;
        paint(src,url);
        hideFade();
      }
    } catch (error) {
      console.warn('[login background] Rotation failed:', error);
    } finally {
      busy = false;
      if (token === generation) due = Date.now() + INTERVAL;
      if (visible) nextTimer();
    }
  }

  new MutationObserver(onVisibility).observe(overlay, {
    attributes: true, attributeFilter: ['style','class','hidden']
  });
  document.addEventListener('visibilitychange',onVisibility);
  window.addEventListener('pageshow',onVisibility);
  fetch('/login-backgrounds/backgrounds.json',{cache:'no-store'})
    .then(result => result.ok ? result.json() : Promise.reject(Error('Manifest unavailable')))
    .then(data => {
      const list = Array.isArray(data.images) ? data.images.map(x => x?.src) : [];
      const valid = list.filter(s => typeof s === 'string' && s.startsWith('/login-backgrounds/') &&
        /\.(png|jpe?g|webp|avif)$/i.test(s));
      if (!valid.length) return;
      photos = [...new Set(valid)];
      resetOrder(); // Alters future order only; no immediate image change.
    })
    .catch(() => {});
  onVisibility();
  if (visible) void prepareReturn(); // Preload while the first login is visible.
})();
