/* Private media on every device. Google ID token is verified on Vercel
   and exchanged for a short-lived HttpOnly same-origin session cookie.
   Images/videos no longer rely on third-party Drive cookies. */
(() => {
  'use strict';
  if (window.__vlMediaSessionInstalled) return;
  window.__vlMediaSessionInstalled = true;
  const CLIENT_ID = '1034177686409-1fhm0m0tqmf58qjj1p0r2ifo018eh8o2.apps.googleusercontent.com';
  const API = '/api/media';
  let ready = false;
  let panel = null;
  let refreshTask = null;
  let captureInstalled = false;
  let signInInitialized = false;
  let lastClickedId = '';
  let lastShown = 0;
  let proxyVersion = 0;
  const idPattern = /^[\w-]{10,160}$/;
  const mobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  let needsProxy = false;

  function idOf(input) {
    try {
      const src = String(input || '');
      const u = new URL(src, location.href);
      const id = u.searchParams.get('id') || u.searchParams.get('fileId');
      if (id && idPattern.test(id) &&
          (u.hostname === 'drive.google.com' || u.pathname === API)) return id;
      const match = u.pathname.match(/\/file\/d\/([\w-]+)/);
      if (u.hostname === 'drive.google.com' && match && idPattern.test(match[1])) return match[1];
    } catch (_) {}
    return null;
  }
  function proxy(id, variant) {
    return API+'?fileId='+encodeURIComponent(id)+'&variant='+variant+'&v='+proxyVersion;
  }
  async function authorize(credential) {
    if (!credential) throw new Error('Google chưa trả mã đăng nhập');
    const result = await fetch(API, {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({credential,...(window.vlShareScope?.grant?{shareGrant:window.vlShareScope.grant}:{})})
    });
    const data = await result.json();
    if (!result.ok || data.success !== true)
      throw new Error(data.message || 'Không thể xác thực quyền xem ảnh');
    if(window.vlShareScope && data.scopeRoot!==window.vlShareScope.root)
      throw new Error('Phiên Google không đúng thư mục được chia sẻ');
    ready = true;
    proxyVersion++;
    window.vlMediaProxyReady = true;
    hidePanel();
    scheduleReconcile();
    return data;
  }
  window.vlMediaAuthorize = authorize;

  // Intercept the app's Google Sign-in credential when it is already asking
  // the user to log in, without changing its authorization callback.
  function installGoogleCapture() {
    if (captureInstalled || !window.google?.accounts?.id?.initialize) return;
    const service = window.google.accounts.id;
    const previous = service.initialize;
    if (previous.__vlCapture) { captureInstalled = true; return; }
    const replacement = function(opts) {
      const callback = opts?.callback;
      return previous.call(this, {
        ...opts,
        callback(response) {
          if (response?.credential)
            void authorize(response.credential).catch(err =>
              console.warn('[QL Ảnh] Chưa có phiên xem media:',err));
          if (typeof callback === 'function') return callback(response);
        }
      });
    };
    replacement.__vlCapture = true;
    try { service.initialize = replacement; captureInstalled = true; }
    catch (err) { captureInstalled = true; console.warn('[QL Ảnh] Google capture unavailable',err); }
  }
  installGoogleCapture();
  const captureTimer = setInterval(() => {
    installGoogleCapture();
    if (captureInstalled) clearInterval(captureTimer);
  }, 70);

  function hidePanel() {
    if (panel) { panel.hidden = true; panel.style.display = 'none'; }
  }
  function ensurePanel() {
    if (panel?.isConnected) return panel;
    const target = document.getElementById('contentArea');
    if (!target?.parentElement) return null;
    panel = document.createElement('section');
    panel.id = 'vlMediaAuthentication';
    panel.setAttribute('role','status');
    panel.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;padding:10px 14px;background:#fff8ea;color:#784c13;font:600 13px system-ui;border-bottom:1px solid #ead6a1;position:relative;z-index:11;';
    panel.hidden = true;
    panel.style.display = 'none';
    const info = document.createElement('span');
    info.textContent = 'Cho phép QL Ảnh xác thực tài khoản Google để xem ảnh/video trên thiết bị này.';
    panel.appendChild(info);
    const permit = document.createElement('button');
    permit.type = 'button';
    permit.id = 'vlMediaAllowButton';
    const googleLogo=document.createElement('img');
    googleLogo.src='https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png';
    googleLogo.alt='Google';
    googleLogo.style.cssText='height:21px;width:21px;object-fit:contain;';
    const label=document.createElement('span');label.textContent='Cho phép';
    permit.append(googleLogo,label);
    permit.setAttribute('aria-label','Cho phép xác thực Google');
    permit.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:126px;min-height:44px;padding:10px 20px;border:0;border-radius:999px;background:white;color:#1f2937;gap:10px;border:1px solid #d1d5db;font:700 15px system-ui;cursor:pointer;touch-action:manipulation;';
    permit.addEventListener('click',requestMediaPermission);
    panel.appendChild(permit);
    const slot = document.createElement('div');
    slot.id = 'vlMediaSignInButton';
    slot.style.display = 'none';
    panel.appendChild(slot);
    const retry = document.createElement('button');
    retry.type='button';
    retry.textContent='Thử lại';
    retry.style.cssText='border:1px solid #d8bc7e;padding:7px 12px;border-radius:10px;background:white;';
    retry.addEventListener('click',()=>void checkSession(true));
    panel.appendChild(retry);
    target.parentElement.insertBefore(panel, target);
    return panel;
  }
  function initializeMediaAuth() {
    if(signInInitialized)return true;
    const sdk=window.google?.accounts?.id;
    if(!sdk?.initialize)return false;
    if(!localStorage.getItem('vinhloc_authenticated_email'))return false;
    sdk.initialize({
      client_id:CLIENT_ID,
      callback:response => {
        if(response?.credential)void authorize(response.credential).catch(err=>{
          const el=panel?.querySelector('span');
          if(el)el.textContent='Xác thực Google thất bại: '+err.message;
        });
      },
      auto_select:false
    });
    signInInitialized=true;
    return true;
  }
  function showGoogleFallback() {
    if(ready)return;
    const slot=document.getElementById('vlMediaSignInButton');
    if(!slot)return;
    slot.style.display='flex';
    slot.style.justifyContent='center';
    if(slot.dataset.ready==='1')return;
    if(!initializeMediaAuth()) {
      setTimeout(showGoogleFallback,450);
      return;
    }
    try {
      window.google.accounts.id.renderButton(slot,{
        type:'standard',theme:'outline',size:'large',
        text:'continue_with',shape:'rectangular',width:240,locale:'vi'
      });
      slot.dataset.ready='1';
    }catch(err){
      console.warn('[QL Ảnh] Không thể mở nút Google dự phòng',err);
    }
  }
  function requestMediaPermission(){
    // A custom "Cho phép" button requests the standard Google One Tap
    // authorization. iOS Web Apps may block One Tap, so fall back to the
    // official Google Identity Services button instead of faking a login.
    const sdk=window.google?.accounts?.id;
    if(!sdk?.prompt || !initializeMediaAuth()){
      showGoogleFallback();
      return;
    }
    try {
      sdk.prompt(notification=>{
        if(notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.())
          showGoogleFallback();
      });
      // Some Safari/PWA versions never dispatch the moment callback.
      setTimeout(()=>{if(!ready)showGoogleFallback();},1700);
    }catch(error){
      console.warn('[QL Ảnh] Google xác thực qua nút Cho phép:',error);
      showGoogleFallback();
    }
  }
  // Ownership APIs require the verified cookie scoped to /api, while old
  // sessions may still have the legacy /api/media-only cookie.
  window.vlMediaRequireReauth=()=>{
    ready=false;
    window.vlMediaProxyReady=false;
    showPanel();
  };
  window.vlMediaEnsureAuth=()=>checkSession(true);
  function showPanel() {
    if (ready || Date.now()-lastShown<1200) return;
    lastShown = Date.now();
    const element = ensurePanel();
    if (!element) return;
    element.hidden = false;
    element.style.display = 'flex';
    // The primary action is Cho phép; official Google button appears only
    // when the iOS/Google consent prompt cannot be displayed.
  }
  async function checkSession(showWhenMissing = false) {
    try {
      const response = await fetch(API+'?status=1', {
        method:'GET',credentials:'same-origin',cache:'no-store'
      });
      if (!response.ok) throw new Error('Chưa có phiên');
      const data = await response.json();
      if (data.success !== true) throw new Error('Chưa xác thực');
      if(window.vlShareScope &&
         (!window.vlShareScope.ready() || data.scopeRoot!==window.vlShareScope.root))
        throw new Error('Phiên xem ảnh không thuộc thư mục được chia sẻ');
      if (!ready) proxyVersion++;
      ready=true;window.vlMediaProxyReady=true;
      hidePanel();scheduleReconcile();
      return true;
    } catch (_) {
      ready=false;window.vlMediaProxyReady=false;
      if (showWhenMissing) showPanel();
      return false;
    }
  }
  function selectedMediaId(el) {
    return idOf(el.getAttribute('src')) ||
      idOf(el.getAttribute('data-url')) ||
      idOf(el.currentSrc) ||
      (el.closest('#mediaContent') ? lastClickedId : null);
  }
  function setImageUrl(img) {
    if (!ready || !img.isConnected) return;
    if ((img.getAttribute('src') || '').startsWith('blob:')) return;
    const id = selectedMediaId(img);
    if (!id) return;
    const full = !!img.closest('#mediaContent');
    const desired = proxy(id, full ? 'full':'thumb');
    const current = img.getAttribute('src') || '';
    if (current === desired) return;
    // The thumbnail recovery module adds thumbRetry=N while Drive is still
    // processing a batch upload. Do not reset the URL from MutationObserver.
    try {
      const existing = new URL(current, location.href);
      const expected = new URL(desired, location.href);
      if (existing.pathname === expected.pathname &&
          existing.searchParams.get('fileId') === id &&
          existing.searchParams.get('variant') === expected.searchParams.get('variant') &&
          existing.searchParams.get('v') === expected.searchParams.get('v')) return;
    } catch (_) {}
    img.dataset.vlMediaProxy = '1';
    img.dataset.vlMediaId = id;
    // Old Drive-URL recovery must not overwrite our authenticated URL.
    img.dataset.vlFallback = 'loaded';
    img.onerror = null; // legacy onerror sets an external placeholder URL
    img.src = desired;
  }
  function setVideoPlayer(iframe) {
    if (!ready || !iframe.isConnected || !iframe.closest('#mediaContent')) return;
    const id = idOf(iframe.getAttribute('src')) || lastClickedId;
    if (!id) return;
    const player = document.createElement('video');
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    player.style.cssText='height:100%;max-height:100%;max-width:100%;width:100%;background:#000;';
    player.src = proxy(id,'full');
    player.addEventListener('error',()=>{void checkSession(true);},{once:true});
    iframe.replaceWith(player);
  }
  function reconcile() {
    if (!ready || (!mobileDevice && !needsProxy)) return;
    document.querySelectorAll('#fileList img,#mediaContent img').forEach(setImageUrl);
    document.querySelectorAll('#mediaContent iframe').forEach(setVideoPlayer);
    document.querySelectorAll('#mediaContent video').forEach(video => {
      const src=video.getAttribute('src') || '';
      const id=idOf(src) || (!src && lastClickedId ? lastClickedId:null);
      if (id && !src.startsWith('blob:')) {
        const target=proxy(id,'full');
        if (src!==target) video.src=target;
      }
    });
  }
  function scheduleReconcile() {
    if (refreshTask!==null) return;
    refreshTask = setTimeout(()=>{refreshTask=null;reconcile();},70);
  }
  function initObservers() {
    const gallery=document.getElementById('fileList');
    const viewer=document.getElementById('mediaContent');
    const observer=new MutationObserver(scheduleReconcile);
    for(const element of [gallery,viewer]) {
      if (element) observer.observe(element,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
    }
    document.addEventListener('click',event => {
      const el=event.target.closest?.('[onclick*="openMedia"],[onclick*="openSearchResult"]');
      const raw=el?.getAttribute('onclick')||'';
      const match=raw.match(/open(?:Media|SearchResult)\s*\(\s*['"]([\w-]{10,160})/);
      if(match)lastClickedId=match[1];
    },true);
    document.addEventListener('error',event => {
      if (!(event.target instanceof HTMLImageElement)) return;
      const img=event.target;
      if (!img.closest('#fileList,#mediaContent')) return;
      if (ready) {
        const src=img.getAttribute('src') || '';
        if (!src.startsWith(API)) {
          needsProxy = true;
          event.stopImmediatePropagation();
          setImageUrl(img);
          return;
        }
        // A failed same-origin request may be a session expiry or a Drive
        // permission error. Surface the real HTTP error instead of a blank icon.
        void (async () => {
          const session = await checkSession(true);
          if (!session) return;
          try {
            const response = await fetch(src, {credentials:'same-origin',cache:'no-store'});
            if (response.ok || (
              src.includes('variant=thumb') &&
              [404,408,429,500,502,503,504].includes(response.status)
            )) return; // Transient thumbnail: retry in place, no repetitive toast.
            const error = await response.json().catch(()=>({}));
            const message = 'Lỗi phát ảnh: '+(error.message || 'HTTP '+response.status);
            if (typeof window.showToast === 'function') window.showToast(message,true);
            else console.warn(message);
          } catch (err) { console.warn('[QL Ảnh] Media connection error',err); }
        })();
      } else {
        showPanel();
      }
    },true);
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden)void checkSession(false);
    });
    void checkSession(false);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initObservers);
  else initObservers();
})();
