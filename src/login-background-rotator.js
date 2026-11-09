/* Stable login wallpaper scheduler. Exactly one transition per interval,
 * including first launch, returning from sign-out, and foreground resume.
 * Keep the currently painted photo unchanged until 8.5 seconds elapse. */
(() => {
  'use strict';
  if (window.__vlStableLoginWallpaperInstalled) return;
  const overlay = document.getElementById('auth-overlay');
  const preview = document.getElementById('vl-login-backgrounds');
  if (!overlay || !preview) return;
  window.__vlStableLoginWallpaperInstalled = true;

  const baseSources = ["/login-backgrounds/316e9496-bd61-457c-a431-37259a524b75.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_37%209%20thg%2011%2C%202026-1.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-2.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-3.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_39%209%20thg%2011%2C%202026-4.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-5.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-6.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_41%209%20thg%2011%2C%202026-7.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_42%209%20thg%2011%2C%202026-8.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-9.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-10.png"];
  const remoteBases = [
    'https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public',
    'https://cdn.jsdelivr.net/gh/lekhanhduy-IT/vinhloc-drive-gallery-app@main/public'
  ];
  const INTERVAL_MS = 8500;
  const FADE_MS = 1150;
  const LOAD_TIMEOUT_MS = 10000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let sources = shuffle(baseSources.slice());
  let index = 0;
  let timer = null;
  let isVisible = false;
  let busy = false;
  let epoch = 0;

  function canonical(url) {
    try {
      const path = new URL(url, location.href).pathname;
      const i = path.indexOf('/login-backgrounds/');
      return i >= 0 ? path.slice(i) : path;
    } catch (_) { return String(url || ''); }
  }
  const initialMatch = overlay.style.backgroundImage.match(/url\((['"]?)(.*?)\1\)/);
  let currentPhoto = canonical(initialMatch ? initialMatch[2] : baseSources[0]);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function onLoginScreen() {
    if (document.hidden || overlay.hidden || overlay.classList.contains('hidden')) return false;
    const style = getComputedStyle(overlay);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    // Do not reset an existing timer on style mutations or manifest arrival.
    if (!isVisible || busy || timer !== null || reducedMotion.matches ||
        sources.length < 2) return;
    const session = epoch;
    timer = setTimeout(() => {
      timer = null;
      if (session === epoch && isVisible) void advance(session);
    }, INTERVAL_MS);
  }
  function visibilityChanged() {
    const now = onLoginScreen();
    if (now === isVisible) return; // Own backgroundImage mutations are NOT new sessions.
    isVisible = now;
    epoch++;
    stopTimer();
    preview.classList.remove('is-visible');
    // On sign-out, show the existing full-size image immediately. Wait one
    // complete interval before any change; never fast-forward missed slides.
    if (isVisible) schedule();
  }
  function preload(url) {
    return new Promise(resolve => {
      const img = new Image();
      let settled = false;
      const deadline = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      }
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }
  async function workingUrl(src, session) {
    for (const url of [src, ...remoteBases.map(base => base + src)]) {
      if (session !== epoch || !isVisible) return null;
      if (await preload(url)) return url;
    }
    return null;
  }
  const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

  async function advance(session) {
    if (session !== epoch || busy || !isVisible || sources.length < 2) return;
    busy = true;
    try {
      let nextSource = null;
      let nextUrl = null;
      // Try fallbacks without ever painting each candidate on screen.
      for (let tries = 0; tries < sources.length; tries++) {
        const source = sources[index++ % sources.length];
        if (canonical(source) === currentPhoto) continue;
        const found = await workingUrl(source, session);
        if (session !== epoch || !isVisible) return;
        if (found) {
          nextSource = source;
          nextUrl = found;
          break;
        }
      }
      if (!nextUrl || session !== epoch || !isVisible) return;
      const cssUrl = 'url(' + JSON.stringify(nextUrl) + ')';
      preview.classList.remove('is-visible');
      preview.style.backgroundImage = cssUrl;
      // Reflow once so iOS Safari starts one fade, not several quick paints.
      void preview.offsetWidth;
      if (session !== epoch || !isVisible) return;
      preview.classList.add('is-visible');
      await sleep(FADE_MS);
      if (session !== epoch || !isVisible) return;
      overlay.style.backgroundImage = cssUrl;
      currentPhoto = canonical(nextSource);
      preview.classList.remove('is-visible');
    } catch (error) {
      console.warn('[login backgrounds] Cannot rotate photo:', error);
    } finally {
      busy = false;
      // Never immediately catch up old timers after returning to the login.
      // The next image always gets a new full interval.
      if (isVisible) schedule();
    }
  }

  // Listen for login/logout without restarting the 8.5-second countdown on
  // our own style writes, title changes, or unrelated app updates.
  new MutationObserver(visibilityChanged).observe(overlay, {
    attributes: true, attributeFilter: ['style', 'class', 'hidden']
  });
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pageshow', visibilityChanged);
  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) stopTimer();
    else schedule();
  });

  // Manifest only updates the FUTURE order. It never changes the visible
  // background or starts another countdown if one already exists.
  fetch('/login-backgrounds/backgrounds.json', {cache: 'no-store'})
    .then(response => {
      if (!response.ok) throw Error('Manifest HTTP ' + response.status);
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data.images)) return;
      const valid = data.images.map(item => item?.src).filter(src =>
        typeof src === 'string' && src.startsWith('/login-backgrounds/') &&
        /\.(?:png|jpe?g|webp|avif)$/i.test(src)
      );
      if (valid.length) {
        sources = shuffle([...new Set(valid)]);
        index = 0;
        schedule();
      }
    })
    .catch(err => console.warn('[login backgrounds] Using built-in image list:', err));

  // A photo is already painted in HTML; startup only begins a countdown.
  visibilityChanged();
})();
