/* Strictly paced login slideshow for desktop and mobile.
 * An initial/background-resume/login screen holds its photo for one complete
 * 8.5s interval. No catch-up transitions and no multi-photo bursts. */
(() => {
  'use strict';
  if (window.__vlStableLoginWallpaperInstalled) return;
  const overlay = document.getElementById('auth-overlay');
  const layer = document.getElementById('vl-login-backgrounds');
  if (!overlay || !layer) return;
  window.__vlStableLoginWallpaperInstalled = true;

  const INTERVAL_MS = 8500;
  const FADE_MS = 1150;
  const LOAD_TIMEOUT_MS = 4200;
  const builtInSources = ["/login-backgrounds/316e9496-bd61-457c-a431-37259a524b75.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_37%209%20thg%2011%2C%202026-1.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-2.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-3.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_39%209%20thg%2011%2C%202026-4.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-5.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-6.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_41%209%20thg%2011%2C%202026-7.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_42%209%20thg%2011%2C%202026-8.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-9.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-10.png"];
  // Independent wallpaper collection for desktop-width windows.
  const desktopBuiltInSources = ["/login-backgrounds-desktop/1.png","/login-backgrounds-desktop/2.png","/login-backgrounds-desktop/3.png"];
  const desktopMedia = window.matchMedia?.('(min-width: 1024px)');
  const isDesktop = () => !!desktopMedia?.matches;
  const openingWallpapers = { mobile: "https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-9.png", desktop: "https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public/login-backgrounds-desktop/1.png" };
  const remoteBases = [
    'https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public',
    'https://cdn.jsdelivr.net/gh/lekhanhduy-IT/vinhloc-drive-gallery-app@main/public'
  ];
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let sources = shuffle((isDesktop() ? desktopBuiltInSources : builtInSources).slice());
  let cursor = 0;
  let timer = null;
  let busy = false;
  let visible = false;
  let generation = 0;
  let allowedAt = Date.now() + INTERVAL_MS;

  // This is a purely temporal safety guard. It never changes what photo
  // appears on first paint and cannot cause a visible change on reload.
  const DUE_KEY = 'vl-login-background-due-v3';
  try {
    const previous = Number(sessionStorage.getItem(DUE_KEY));
    if (Number.isFinite(previous) && previous > Date.now() &&
        previous < Date.now() + 2 * INTERVAL_MS) allowedAt = Math.max(allowedAt, previous);
  } catch (_) {}

  function rememberDue() {
    try { sessionStorage.setItem(DUE_KEY, String(allowedAt)); } catch (_) {}
  }
  function shuffle(values) {
    for (let n = values.length - 1; n > 0; n--) {
      const k = Math.floor(Math.random() * (n + 1));
      [values[n], values[k]] = [values[k], values[n]];
    }
    return values;
  }
  function canonical(src) {
    try {
      const path = new URL(src, location.href).pathname;
      const where = /\/login-backgrounds(?:-desktop)?\//.exec(path);
      return where ? path.slice(where.index) : path;
    } catch (_) { return String(src || ''); }
  }
  // Computed style includes the desktop opening photo from the critical CSS.
  const initialUrl = /url\((['"]?)(.*?)\1\)/.exec(getComputedStyle(overlay).backgroundImage);
  let current = canonical(initialUrl ? initialUrl[2] :
    (isDesktop() ? desktopBuiltInSources[0] : builtInSources[0]));

  function shown() {
    if (document.hidden || overlay.hidden || overlay.classList.contains('hidden')) return false;
    const css = getComputedStyle(overlay);
    return css.display !== 'none' && css.visibility !== 'hidden';
  }
  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    if (!visible || busy || timer !== null || sources.length < 2) return;
    const token = generation;
    const remaining = Math.max(0, allowedAt - Date.now());
    timer = setTimeout(() => {
      timer = null;
      if (token === generation && visible) void changeOne(token);
    }, remaining);
  }
  function onVisibility() {
    const nowVisible = shown();
    // The overlay's style attribute changes at the end of each fade; those
    // mutations must not start another 8.5s timer.
    if (nowVisible === visible) return;
    visible = nowVisible;
    generation++;
    cancelTimer();
    layer.classList.remove('is-visible');
    if (!visible) return;
    allowedAt = Math.max(allowedAt, Date.now() + INTERVAL_MS);
    rememberDue();
    schedule();
  }
  function probe(src, timeoutMs=LOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const timeout = setTimeout(() => finish(false), timeoutMs);
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      }
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = src;
    });
  }
  async function loadPhoto(src, token) {
    // First use files served by this deployment. Only try hosted fallbacks
    // if the local URL genuinely fails; a failed image never reaches the UI.
    for (const url of [src, ...remoteBases.map(root => root + src)]) {
      if (token !== generation || !visible) return null;
      if (await probe(url)) return url;
    }
    return null;
  }
  function pickNext() {
    for (let n = 0; n < sources.length; n++) {
      const source = sources[cursor++ % sources.length];
      if (canonical(source) !== current) return source;
    }
    return null;
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function changeOne(token) {
    if (busy || !visible || token !== generation || Date.now() < allowedAt) {
      schedule();
      return;
    }
    busy = true;
    try {
      // Probe exactly ONE candidate per interval, rather than scanning all
      // 11 photos and unexpectedly creating a cascade of load/paint events.
      const candidate = pickNext();
      if (!candidate) return;
      const url = await loadPhoto(candidate, token);
      if (!url || token !== generation || !visible) return;
      const cssImage = 'url(' + JSON.stringify(url) + ')';

      if (media?.matches) {
        // Reduced motion removes animation only, NEVER stops the slideshow.
        overlay.style.setProperty('background-image', cssImage, 'important');
      } else {
        layer.classList.remove('is-visible');
        layer.style.backgroundImage = cssImage;
        void layer.offsetWidth; // start only one opacity transition
        if (token !== generation || !visible) return;
        layer.classList.add('is-visible');
        await sleep(FADE_MS);
        if (token !== generation || !visible) return;
        overlay.style.setProperty('background-image', cssImage, 'important');
        layer.classList.remove('is-visible');
      }
      current = canonical(candidate);
    } catch (error) {
      console.warn('[login background] One photo could not be shown:', error);
    } finally {
      busy = false;
      // Applies even after an unsuccessful download. In every case the next
      // attempt is at least 8.5 seconds away, not an immediate retry burst.
      allowedAt = Date.now() + INTERVAL_MS;
      rememberDue();
      if (visible) schedule();
    }
  }
  new MutationObserver(onVisibility).observe(overlay, {
    attributes: true, attributeFilter: ['style', 'class', 'hidden']
  });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);

  let manifestSequence = 0;
  function loadManifest() {
    const request = ++manifestSequence;
    const prefix = isDesktop() ? '/login-backgrounds-desktop' : '/login-backgrounds';
    fetch(prefix + '/backgrounds.json', {cache:'no-store'})
      .then(response => {
        if (!response.ok) throw Error('Manifest HTTP ' + response.status);
        return response.json();
      })
      .then(data => {
        if (request !== manifestSequence || !Array.isArray(data.images)) return;
        const valid = data.images.map(item => item?.src).filter(src =>
          typeof src === 'string' &&
          src.startsWith(prefix + '/') &&
          /\.(?:png|jpe?g|webp|avif)$/i.test(src)
        );
        if (valid.length) {
          sources = shuffle([...new Set(valid)]);
          cursor = 0;
          // Manifest changes must not interrupt the current photo.
          schedule();
        }
      })
      .catch(err => console.warn('[login background] Embedded image list in use:', err));
  }

  function onScreenModeChange() {
    generation++;
    cancelTimer();
    layer.classList.remove('is-visible');
    layer.style.backgroundImage = '';
    sources = shuffle((isDesktop() ? desktopBuiltInSources : builtInSources).slice());
    cursor = 0;
    const first = isDesktop() ? openingWallpapers.desktop : openingWallpapers.mobile;
    const token = generation;
    allowedAt = Date.now() + INTERVAL_MS;
    rememberDue();
    loadManifest();
    // Do not replace the current wallpaper until the new source has loaded.
    void probe(first).then(ok => {
      if (!ok || token !== generation) return;
      overlay.style.setProperty('background-image', 'url(' + JSON.stringify(first) + ')', 'important');
      current = canonical(first);
    });
    if (visible) schedule();
  }
  if (desktopMedia?.addEventListener) desktopMedia.addEventListener('change', onScreenModeChange);
  else desktopMedia?.addListener?.(onScreenModeChange);
  loadManifest();

  // The HTML has already painted the initial background. No slideshow image
  // is painted until its full first 8.5-second hold completes.
  rememberDue();
  onVisibility();
})();
