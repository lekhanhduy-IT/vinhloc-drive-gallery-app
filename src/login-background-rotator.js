/* Login background is visible in HTML even if this module fails.
 * Manifest is refreshed on each deploy. If local assets return 404, use the
 * exact same files from this public GitHub repo rather than a white page. */
(() => {
  'use strict';
  const overlay = document.getElementById('auth-overlay');
  const preview = document.getElementById('vl-login-backgrounds');
  if (!overlay || !preview) return;
  const baseSources = ["/login-backgrounds/316e9496-bd61-457c-a431-37259a524b75.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_37%209%20thg%2011%2C%202026-1.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-2.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_38%209%20thg%2011%2C%202026-3.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_39%209%20thg%2011%2C%202026-4.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-5.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_40%209%20thg%2011%2C%202026-6.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_41%209%20thg%2011%2C%202026-7.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_42%209%20thg%2011%2C%202026-8.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-9.png","/login-backgrounds/%E1%BA%A2nh%20ChatGPT%2003_20_43%209%20thg%2011%2C%202026-10.png"];
  const remoteBases = [
    'https://raw.githubusercontent.com/lekhanhduy-IT/vinhloc-drive-gallery-app/main/public',
    'https://cdn.jsdelivr.net/gh/lekhanhduy-IT/vinhloc-drive-gallery-app@main/public'
  ];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const ROTATE_MS = 8500;
  const FADE_MS = 1150;
  let photos = baseSources.slice();
  let position = 0;
  let timer = null;
  let running = false;

  function active() {
    return !document.hidden && !overlay.hidden && getComputedStyle(overlay).display !== 'none';
  }
  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function next() {
    clear();
    if (!photos.length || !active() || reducedMotion.matches) return;
    timer = setTimeout(() => { timer = null; void rotate(); }, ROTATE_MS);
  }
  function testImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }
  function cssBackground(url) {
    return 'url(' + JSON.stringify(url) + ')';
  }
  async function findWorkingImage(src) {
    if (!src.startsWith('/login-backgrounds/')) return null;
    const candidates = [src, ...remoteBases.map(base => base + src)];
    for (const url of candidates) {
      if (await testImage(url)) return url;
    }
    return null;
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function rotate() {
    if (running || !active() || !photos.length) return;
    running = true;
    try {
      let result = null;
      for (let attempt=0; attempt<photos.length; attempt++) {
        const src = photos[position++ % photos.length];
        result = await findWorkingImage(src);
        if (result) break;
      }
      if (!result || !active()) return;
      const background = cssBackground(result);
      if (reducedMotion.matches) {
        overlay.style.backgroundImage = background;
        return;
      }
      preview.style.backgroundImage = background;
      preview.classList.add('is-visible');
      await sleep(FADE_MS);
      overlay.style.backgroundImage = background;
      preview.classList.remove('is-visible');
    } catch (error) {
      console.warn('[login backgrounds] Failed to switch photo:', error);
    } finally {
      running = false;
      next();
    }
  }
  function visibilityChanged() {
    if (!active()) { clear(); return; }
    if (!running && timer === null) next();
  }
  for (let i=photos.length-1; i>0; i--) {
    const j=Math.floor(Math.random()*(i+1));
    [photos[i],photos[j]]=[photos[j],photos[i]];
  }
  new MutationObserver(visibilityChanged).observe(overlay, {
    attributes: true, attributeFilter: ['style','class','hidden']
  });
  addEventListener('pageshow', visibilityChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  reducedMotion.addEventListener?.('change', visibilityChanged);

  fetch('/login-backgrounds/backgrounds.json', {cache:'no-store'})
    .then(r => { if(!r.ok)throw Error('Manifest HTTP '+r.status); return r.json(); })
    .then(data => {
      if (!Array.isArray(data.images)) return;
      const sources = [...new Set(data.images.map(item => item?.src)
        .filter(src => typeof src==='string' &&
          src.startsWith('/login-backgrounds/') &&
          /\.(png|jpe?g|webp|avif)$/i.test(src)))];
      if (sources.length) {
        photos = sources;
        for (let i=photos.length-1; i>0; i--) {
          const j=Math.floor(Math.random()*(i+1));
          [photos[i],photos[j]]=[photos[j],photos[i]];
        }
        position=0;
        visibilityChanged();
      }
    })
    .catch(error => console.warn('[login backgrounds] Using embedded image list:',error));
  // Ensure visible background continues to work if the slideshow file fails.
  visibilityChanged();
})();
