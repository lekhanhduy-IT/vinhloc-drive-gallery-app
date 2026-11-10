/* QL Anh – native Google Identity Services buttons.
   Keep the main login below 200px: Google's official UX intentionally
   suppresses account-personalized buttons below that threshold.
   Do not cover, scale, or forward fake clicks to the Google iframe.
   Shared-folder authentication retains its own credential callback. */
(() => {
  'use strict';
  if (window.__vlNativeGoogleSigninV315) return;
  window.__vlNativeGoogleSigninV315 = true;

  const query = new URLSearchParams(location.search);
  const isShare = !!(query.get('shareId') && query.get('shareType') === 'folder');
  const targets = new Set(['google-login-btn', 'vlSharedGoogleSignin']);
  // Google paints its iframe asynchronously. An in-flight render must count
  // as rendered BEFORE the iframe arrives, otherwise simultaneous login
  // initializers append two native buttons and resize the centered panel.
  const renderStates = new WeakMap();
  let installedSDK = null;

  // Keep the native Google iframe invisible during its intermediate paints.
  // The host keeps its 48px footprint, so the login layout never shifts.
  const appearanceGates = new WeakMap();
  function gateNativeButton(element) {
    if (element.id !== 'google-login-btn') return;
    let gate = appearanceGates.get(element);
    if (gate) { gate.sync(); return; }
    gate = {frame: null, timer: null, fallback: null, sync: null};
    appearanceGates.set(element, gate);

    function cancel() {
      if (gate.timer !== null) clearTimeout(gate.timer);
      if (gate.fallback !== null) clearTimeout(gate.fallback);
      gate.timer = null;
      gate.fallback = null;
    }
    function markReady(frame) {
      if (element.querySelector('iframe') !== frame || !element.isConnected) return;
      element.classList.add('vl-google-ready');
    }
    function afterLoad(frame) {
      if (gate.frame !== frame) return;
      cancel();
      // Allow iOS Safari to complete the cross-origin iframe paint before
      // showing the one interactive Google button.
      gate.timer = setTimeout(() => markReady(frame), 250);
    }
    function sync() {
      const frame = element.querySelector('iframe');
      if (frame === gate.frame) return;
      cancel();
      gate.frame = frame;
      element.classList.remove('vl-google-ready');
      if (!frame) return;
      // The iframe may already have fired load before we observed it.
      frame.addEventListener('load', () => afterLoad(frame), {once: true});
      // A load event is not guaranteed on every iOS PWA resume. Never leave
      // a valid native button hidden forever if Google missed that event.
      gate.fallback = setTimeout(() => markReady(frame), 1600);
    }
    gate.sync = sync;
    new MutationObserver(sync).observe(element, {childList: true, subtree: true});
    sync();
  }

  function sizeFor(element) {
    const available = Math.max(140, (window.innerWidth || 390) - 90);
    // <200px is the documented supported method to disable Google's
    // personalized account button without changing auth behavior.
    return Math.min(element.id === 'google-login-btn' ? 190 : 260, available);
  }

  function install() {
    const sdk = window.google?.accounts?.id;
    if (!sdk?.initialize || !sdk?.renderButton) return false;
    if (sdk === installedSDK) return true;
    if (sdk.renderButton.__vlNativeGoogleSigninV315) {
      installedSDK = sdk;
      return true;
    }

    const originalInitialize = sdk.initialize.bind(sdk);
    const originalRender = sdk.renderButton.bind(sdk);

    sdk.initialize = function(config) {
      // On a shared-folder link the legacy full-workspace auth callback
      // must not replace the folder-specific credential handler.
      if (isShare && config?.callback &&
          typeof window.handleCredentialResponse === 'function' &&
          config.callback === window.handleCredentialResponse) return;

      const callback=config?.callback;
      return originalInitialize({
        ...config,
        // Show the spinner only when Google returns the selected account.
        // Do not modify the native Google iframe, size or click target.
        ...(typeof callback==='function'?{
          callback:function(response){
            if(response?.credential)window.vlAuthWait?.begin();
            return callback.call(this,response);
          }
        }:{}),
        auto_select: false,
        button_auto_select: false,
        use_fedcm_for_button: false
      });
    };

    function renderNative(target, requested) {
      const element = typeof target === 'string'
        ? document.querySelector(target) : target;
      if (!element || !targets.has(element.id)) {
        return originalRender(target, requested);
      }

      if (isShare && element.id === 'google-login-btn') {
        element.replaceChildren();
        return;
      }
      gateNativeButton(element);
      // Another initializer may already have rendered this native iframe
      // before our wrapper arrived. Adopt it; never destroy a working button.
      if (element.querySelector('iframe') && !renderStates.has(element)) {
        renderStates.set(element, {phase: 'ready', started: Date.now(), observer: null});
        return;
      }
      const previous = renderStates.get(element);
      if (previous) {
        if (element.querySelector('iframe')) {
          previous.phase = 'ready';
          return;
        }
        // A pending SDK render can have an empty host for several frames.
        // Do not issue a second request until the first one finishes or
        // unmistakably fails. This fixes the double-button startup flash.
        if (previous.phase === 'pending' && (Date.now() - previous.started < 10000 ||
            element.childElementCount > 0)) return;
        // A ready iframe removed by logout may be rendered again, but do not
        // replace a half-initialized Google host.
        if (element.childElementCount > 0) return;
        previous.observer?.disconnect();
        renderStates.delete(element);
      }

      element.querySelectorAll('.vl-google-readable-label')
        .forEach(label => label.remove());
      element.replaceChildren();
      element.classList.add('vl-native-google-signin');
      const width = sizeFor(element);
      element.style.width = width + 'px';
      element.style.maxWidth = '100%';
      // Reserve exactly one native-button slot from the FIRST paint.
      element.style.height = '48px';
      element.style.minHeight = '48px';
      element.style.position = 'relative';
      element.style.overflow = 'visible';

      const state = {phase: 'pending', started: Date.now(), observer: null};
      renderStates.set(element, state);
      if (typeof MutationObserver !== 'undefined') {
        state.observer = new MutationObserver(() => {
          if (element.querySelector('iframe')) {
            state.phase = 'ready';
            state.observer?.disconnect();
            state.observer = null;
          }
        });
        state.observer.observe(element, {childList: true, subtree: true});
      }
      try {
        const value = originalRender(element, {
          ...requested,
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin',
          width,
          logo_alignment: 'left',
          locale: 'vi'
        });
        if (element.querySelector('iframe')) {
          state.phase = 'ready';
          state.observer?.disconnect();
          state.observer = null;
        }
        // If Google genuinely rendered no DOM, a future explicit call can
        // retry after a long enough timeout. Never reset while a native
        // render is still adding nodes.
        setTimeout(() => {
          if (renderStates.get(element) !== state) return;
          if (element.querySelector('iframe')) {
            state.phase = 'ready';
          } else if (element.childElementCount === 0) {
            state.observer?.disconnect();
            renderStates.delete(element);
          }
        }, 10000);
        return value;
      } catch (error) {
        state.observer?.disconnect();
        renderStates.delete(element);
        // There is no iframe to reveal when the renderer actually failed.
        throw error;
      }
    }
    renderNative.__vlNativeGoogleSigninV315 = true;
    sdk.renderButton = renderNative;
    installedSDK = sdk;
    return true;
  }

  // The GIS script's onload callback installs this wrapper before
  // the legacy app's DOMContentLoaded login initialization.
  window.__vlInstallGoogleSignIn = install;
  if (!install()) {
    const poll = setInterval(() => { if (install()) clearInterval(poll); }, 80);
  }

  document.addEventListener('pageshow', () => {
    for (const id of targets) {
      document.getElementById(id)?.querySelectorAll('.vl-google-readable-label')
        .forEach(label => label.remove());
    }
  });
})();
