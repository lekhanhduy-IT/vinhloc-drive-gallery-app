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
  const rendered = new WeakSet();
  let installedSDK = null;

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

      return originalInitialize({
        ...config,
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
      if (rendered.has(element) && element.querySelector('iframe')) return;

      element.querySelectorAll('.vl-google-readable-label')
        .forEach(label => label.remove());
      element.replaceChildren();
      element.classList.add('vl-native-google-signin');
      const width = sizeFor(element);
      element.style.width = width + 'px';
      element.style.maxWidth = '100%';
      element.style.height = 'auto';
      element.style.minHeight = '44px';
      element.style.position = 'relative';
      element.style.overflow = 'visible';

      rendered.add(element);
      try {
        return originalRender(element, {
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
      } catch (error) {
        rendered.delete(element);
        throw error;
      } finally {
        // An unavailable Google renderer may leave the host empty;
        // permit a later explicit render to retry.
        setTimeout(() => {
          if (!element.querySelector('iframe')) rendered.delete(element);
        }, 1200);
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
