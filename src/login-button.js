/* Full-size native Google Identity Services sign-in.
 *
 * The legacy application still renders type:"icon"/shape:"circle".
 * Replace a legacy 40px icon with a REAL standard-width Google iframe;
 * never stretch an icon or paint a misleading label over it.
 * The visual "Đăng nhập" caption is painted only over an actual clickable
 * Google button >=180px wide and NEVER intercepts pointer events.
 */
(() => {
  'use strict';
  if (window.__vlGoogleFullButtonInstalled) return;
  window.__vlGoogleFullButtonInstalled = true;

  const targets = new Map([
    ['google-login-btn', 'Đăng nhập'],
    ['vlSharedGoogleSignin', 'Đăng nhập']
  ]);
  const lastRequest = new WeakMap();
  let patched = null;
  const MIN_REAL_WIDTH = 180;
  const MAX_REPAINTS = 2;

  function desiredWidth() {
    return Math.max(220, Math.min(290, (window.innerWidth || 390) - 90));
  }
  function options(input) {
    return {...(input || {}), type: 'standard', theme: 'outline',
      size: 'large', shape: 'pill', text: 'signin_with',
      logo_alignment: 'left', width: desiredWidth(), locale: 'vi'};
  }
  function frameWidth(frame) {
    if (!frame || !frame.isConnected) return 0;
    const rect = frame.getBoundingClientRect?.();
    return Math.max(0, rect?.width || 0, frame.offsetWidth || 0);
  }
  function frameHeight(frame) {
    return Math.max(0, frame?.getBoundingClientRect?.().height || 0,
      frame?.offsetHeight || 0);
  }
  function overlay(node, label, frame) {
    if (!node || !frame) return;
    const width = frameWidth(frame), height = frameHeight(frame);
    let tag = node.querySelector('.vl-google-readable-label');
    // iOS sometimes renders the old 40px icon before the SDK is patched.
    // DO NOT draw text outside that small, real Google click area.
    if (width < MIN_REAL_WIDTH || height < 30) {
      if (tag) tag.remove();
      node.dataset.vlGoogleReady = 'compact';
      return;
    }
    node.style.position = 'relative';
    frame.style.pointerEvents = 'auto';
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'vl-google-readable-label';
      tag.setAttribute('aria-hidden', 'true');
      tag.style.cssText = 'position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:999px;background:#fff;border:1px solid #dadce0;box-sizing:border-box;color:#202124;font:700 16px system-ui;pointer-events:none!important;white-space:nowrap;user-select:none;-webkit-user-select:none;overflow:hidden;';
      const icon = document.createElement('img');
      icon.alt = '';
      icon.src = 'https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png';
      icon.style.cssText = 'width:22px;height:22px;object-fit:contain;pointer-events:none!important;flex:none;';
      const caption = document.createElement('span');
      caption.textContent = label;
      caption.style.pointerEvents = 'none';
      tag.append(icon, caption);
      node.appendChild(tag);
    }
    tag.style.left = (frame.offsetLeft || 0) + 'px';
    tag.style.top = (frame.offsetTop || 0) + 'px';
    tag.style.width = width + 'px';
    tag.style.height = height + 'px';
    node.dataset.vlGoogleReady = 'full';
  }
  function updateNode(node, label) {
    const frame = node?.querySelector('iframe');
    if (!frame) return;
    const realWidth = frameWidth(frame);
    if (realWidth >= MIN_REAL_WIDTH) {
      overlay(node, label, frame);
      return;
    }
    overlay(node, label, frame);
    // First render may have come from old_script.js (type:"icon").
    // Re-render exactly once or twice using the native GIS standard layout.
    const state = lastRequest.get(node) || {count:0,time:0};
    if (state.count >= MAX_REPAINTS || Date.now() - state.time < 900) return;
    if (!window.google?.accounts?.id?.renderButton) return;
    lastRequest.set(node, {count:state.count + 1,time:Date.now()});
    const existing = node.querySelector('.vl-google-readable-label');
    existing?.remove();
    node.replaceChildren();
    node.style.width = desiredWidth() + 'px';
    node.style.minHeight = '44px';
    node.style.height = 'auto';
    node.style.maxWidth = '100%';
    // This SDK method is the real Google button renderer: it never
    // synthesizes clicks or bypasses credential consent.
    window.google.accounts.id.renderButton(node, options());
  }
  function installPatch() {
    const service = window.google?.accounts?.id;
    if (typeof service?.renderButton !== 'function') return;
    const base = service.renderButton;
    if (base === patched || base.__vlFullButton) return;
    const wrapper = function(target, requested) {
      const node = typeof target === 'string' ? document.querySelector(target) : target;
      const name = targets.get(node?.id);
      if (!name) return base.call(this, target, requested);
      node.style.width = desiredWidth() + 'px';
      node.style.maxWidth = '100%';
      node.style.minHeight = '44px';
      // The legacy caller passes "icon"/"circle"; do not use those.
      const result = base.call(this, node, options(requested));
      setTimeout(() => updateNode(node, name), 170);
      return result;
    };
    wrapper.__vlFullButton = true;
    try { service.renderButton = patched = wrapper; } catch (_) {}
  }

  installPatch();
  // The SDK is loaded with async/defer. Also repair a compact icon if the
  // legacy app rendered before this patch was able to intercept its call.
  setInterval(() => {
    installPatch();
    for (const [id, label] of targets) {
      const node = document.getElementById(id);
      if (node) updateNode(node, label);
    }
  }, 300);
})();