/* Cross-device media fallback for private Drive files.
   Prefer normal thumbnails, then a short-lived Drive thumbnailLink, then
   an authenticated in-memory Blob. Never make files public or store tokens. */
(() => {
  'use strict';
  if (window.__vlMediaFallbackInstalled) return;
  window.__vlMediaFallbackInstalled = true;
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  const MAX_OBJECT_URLS = 32;
  // GAS returns base64 JSON: keep the emergency path bounded for iPhone RAM.
  const MAX_GAS_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_GAS_BASE64_CHARS = Math.ceil(MAX_GAS_IMAGE_BYTES / 3) * 4 + 8;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let failedNoticeAt = 0;

  const saved = new Map();
  const inflight = new Map();
  const queue = [];
  let inflightCount = 0;
  let lastClickedFile = null;
  const endpoint = 'https://script.google.com/macros/s/AKfycbx3xI-bNWfeffsEH-iIc0yYfF9bHYvAiKZKWIfco6j7Z7GOtOAv7Q8WE1_y9xjen7c/exec';

  function idFromDriveUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      if (/drive\.google\.com$/.test(url.hostname)) {
        const id = url.searchParams.get('id');
        if (id) return id;
        const match = url.pathname.match(/\/(?:file\/d|uc)\/([^/]+)/);
        if (match) return match[1];
      }
    } catch (_) {}
    return null;
  }
  function enqueue(operation) {
    return new Promise((resolve, reject) => {
      queue.push({operation, resolve, reject});
      drain();
    });
  }
  function drain() {
    while (inflightCount < (isIOS ? 2 : 3) && queue.length) {
      const task = queue.shift();
      inflightCount++;
      Promise.resolve().then(task.operation).then(task.resolve, task.reject).finally(() => {
        inflightCount--; drain();
      });
    }
  }
  async function getToken() {
    if (typeof window.vlGetMediaAccessToken === 'function')
      return window.vlGetMediaAccessToken();
    const res = await fetch(endpoint, {method:'POST', body:JSON.stringify({action:'getToken'})});
    const data = await res.json();
    if (!data.success || !data.token) throw new Error('Không nhận được quyền truy cập Drive');
    return data.token;
  }
  async function metadata(id, token) {
    const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=id,name,mimeType,size,thumbnailLink&supportsAllDrives=true';
    const res = await fetch(url, {headers:{Authorization:'Bearer ' + token}, cache:'no-store'});
    if (!res.ok) throw new Error('Không thể đọc thông tin file (' + res.status + ')');
    return res.json();
  }
  function testImage(url, timeoutMs = 6500) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) { finished = true; image.src = ''; reject(new Error('Thumbnail quá hạn')); }
      }, timeoutMs);
      image.onload = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(url); } };
      image.onerror = () => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error('Thumbnail bị từ chối')); } };
      image.src = url;
    });
  }
  async function authenticatedBlob(id, token) {
    const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?alt=media&supportsAllDrives=true';
    let res = await fetch(url, {headers:{Authorization:'Bearer ' + token}, cache:'no-store'});
    if (res.status === 401 && typeof window.vlGetMediaAccessToken === 'function') {
      const fresh = await window.vlGetMediaAccessToken(true);
      res = await fetch(url, {headers:{Authorization:'Bearer ' + fresh}, cache:'no-store'});
    }
    if (!res.ok) throw new Error('Không thể tải nội dung file (' + res.status + ')');
    return res.blob();
  }
  // Direct Drive URLs can fail on Safari even when another device can view
  // them. The existing Apps Script backend reads as the app's Drive owner;
  // it does not depend on iPhone's separate Google cookie session.
  async function appsScriptImageBlob(id) {
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({action: 'getFileBase64', fileId: id}),
        cache: 'no-store',
        signal: controller.signal
      });
      if (!res.ok) throw new Error('Máy chủ ảnh (' + res.status + ')');
      const body = await res.json();
      if (!body || body.success !== true || typeof body.data !== 'string')
        throw new Error(body?.message || body?.error || 'Không đọc được ảnh từ Apps Script');
      if (!/^image\//i.test(body.mimeType || '')) {
        throw new Error('Không phải file ảnh');
      }
      const encoded = body.data.replace(/\s/g, '');
      if (encoded.length > MAX_GAS_BASE64_CHARS)
        throw new Error('Ảnh quá lớn cho chế độ dự phòng trên iPhone');
      // Decode in 256-KiB segments instead of one huge atob() allocation.
      const parts = [];
      for (let offset = 0; offset < encoded.length; offset += 262144) {
        const textPart = atob(encoded.slice(offset, offset + 262144));
        const bytes = new Uint8Array(textPart.length);
        for (let i = 0; i < textPart.length; i++) bytes[i] = textPart.charCodeAt(i);
        parts.push(bytes);
      }
      return new Blob(parts, {type: body.mimeType || 'image/jpeg'});
    } finally {
      clearTimeout(watchdog);
    }
  }

  async function withDeadline(promise, waitMs) {
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Kết nối Drive quá thời gian')), waitMs);
        })
      ]);
    } finally { clearTimeout(timeoutId); }
  }
  async function resolvePreview(id, full) {
    let token, info, oauthError = null;
    try {
      token = await withDeadline(getToken(), 10000);
      info = await withDeadline(metadata(id, token), 10000);
      if (!full && info.thumbnailLink) {
        try {
          const signed = await testImage(info.thumbnailLink, isIOS ? 3500 : 6500);
          return {url: signed, isBlob: false};
        } catch (_) {}
      }
      const mime = info.mimeType || '';
      if (mime.startsWith('image/')) {
        if (Number(info.size || 0) > MAX_IMAGE_BYTES)
          throw new Error('Ảnh vượt quá giới hạn xem trực tiếp');
        const original = await authenticatedBlob(id, token);
        if (original.size > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn');
        const preview = full ? original : await imageThumbnailBlob(original);
        return {url: URL.createObjectURL(preview), isBlob:true};
      }
      if (!full && mime.startsWith('video/') &&
          info.size && Number(info.size) <= MAX_VIDEO_BYTES) {
        const video = await authenticatedBlob(id, token);
        return {url:await posterFromVideo(video), isBlob:true};
      }
      throw new Error('Không có thumbnail phù hợp');
    } catch (error) {
      oauthError = error;
    }
    // Do not pull full videos into base64 JSON. For an unknown MIME, the
    // Apps Script action validates image/* before decoding it in the browser.
    if (info?.mimeType?.startsWith('video/')) throw oauthError;
    try {
      const blob = await appsScriptImageBlob(id);
      if (blob.size > MAX_GAS_IMAGE_BYTES) throw new Error('Ảnh quá lớn');
      const thumbnail = full ? blob : await imageThumbnailBlob(blob);
      return {url: URL.createObjectURL(thumbnail), isBlob:true};
    } catch (gasError) {
      throw new Error('Drive: ' + oauthError.message + '; Apps Script: ' + gasError.message);
    }
  }
  function remember(id, url, isBlob) {
    const old = saved.get(id);
    if (old?.isBlob && old.url !== url) URL.revokeObjectURL(old.url);
    saved.delete(id);
    saved.set(id, {url, isBlob, recordedAt:Date.now()});
    while (saved.size > MAX_OBJECT_URLS) {
      const [evictId, entry] = saved.entries().next().value;
      saved.delete(evictId);
      if (entry.isBlob) URL.revokeObjectURL(entry.url);
    }
    return url;
  }
  async function imageThumbnailBlob(blob) {
    // Cache a 640px thumbnail rather than retaining every full-resolution JPG
    // in RAM on phones with hundreds of photos.
    const source = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error('Không đọc được ảnh'));
        image.onload = () => {
          try {
            const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight, 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(result => result ? resolve(result) :
              reject(new Error('Không nén được thumbnail')), 'image/jpeg', 0.76);
          } catch (error) { reject(error); }
        };
        image.src = source;
      });
    } finally { URL.revokeObjectURL(source); }
  }
  async function imageFallback(id, full = false) {
    const cacheKey = full ? id + ':full' : id;
    const prior = saved.get(cacheKey);
    if (prior && Date.now() - prior.recordedAt < 20 * 60000) return prior.url;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const task = enqueue(async () => {
      const preview = await resolvePreview(id, full);
      return remember(cacheKey, preview.url, preview.isBlob);
    }).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, task);
    return task;
  }
  function posterFromVideo(blob) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(blob);
      const timer = setTimeout(() => stop(new Error('Không đọc được khung hình video')), 10000);
      let finished = false;
      function stop(error, poster) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        video.pause(); video.removeAttribute('src'); video.load();
        URL.revokeObjectURL(url);
        if (error) reject(error); else resolve(poster);
      }
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onloadeddata = () => {
        try {
          const c = document.createElement('canvas');
          const scale = Math.min(1, 480 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
          c.width = Math.max(1, Math.floor(video.videoWidth * scale));
          c.height = Math.max(1, Math.floor(video.videoHeight * scale));
          c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
          c.toBlob(b => b ? stop(null, URL.createObjectURL(b)) :
            stop(new Error('Không tạo được hình xem trước')), 'image/jpeg', 0.72);
        } catch (err) { stop(err); }
      };
      video.onerror = () => stop(new Error('Định dạng video không hỗ trợ'));
      video.src = url;
    });
  }
  function fallbackForImage(img) {
    if (img.dataset.vlFallback === 'running' || img.dataset.vlFallback === 'failed') return;
    const original = img.currentSrc || img.src || img.getAttribute('src');
    const id = idFromDriveUrl(original);
    if (!id) return;
    img.dataset.vlFallback = 'running';
    const full = !!img.closest('#mediaContent');
    imageFallback(id, full).then(url => {
      if (!img.isConnected) return;
      img.onload = () => { img.dataset.vlFallback = 'loaded'; };
      img.src = url;
    }).catch(err => {
      img.dataset.vlFallback = 'failed';
      img.title = 'Không thể tải thumbnail: ' + err.message;
      // Replace a broken image with an inline fallback, without hiding its file card.
      img.removeAttribute('src');
      img.style.objectFit = 'contain';
      img.style.backgroundColor = '#f2f4f8';
      img.alt = 'Không tải được ảnh';
      if (Date.now() - failedNoticeAt > 30000) {
        failedNoticeAt = Date.now();
        console.warn('[QL Ảnh] Thumbnail không tải được trên thiết bị:', err);
        // A concrete error makes a device-specific permission/CORS failure diagnosable.
        if (typeof window.showToast === 'function')
          window.showToast('Lỗi ảnh: ' + String(err.message || err).slice(0, 140), true);
      }
    });
  }
  // Image errors can fire before this script starts, or the legacy renderer
  // can rebuild image cards and replace a fixed Blob URL with the old Drive URL.
  const visibleObserver = typeof IntersectionObserver === 'function' ?
    new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibleObserver.unobserve(entry.target);
        fallbackForImage(entry.target);
      }
    }, {rootMargin:'150px'}) : null;
  function inspectImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    const id = idFromDriveUrl(img.currentSrc || img.src || '');
    if (!id) return;
    const cached = saved.get(id);
    if (cached && Date.now() - cached.recordedAt < 20 * 60000) {
      img.dataset.vlFallback = 'loaded';
      img.src = cached.url;
      return;
    }
    if (img.complete && img.naturalWidth === 0) {
      if (visibleObserver && !img.closest('#mediaContent')) visibleObserver.observe(img);
      else fallbackForImage(img);
    }
  }
  function inspectCurrentImages() {
    document.querySelectorAll('#fileList img, #mediaContent img').forEach(inspectImage);
  }
  function watchGallery() {
    const list = document.getElementById('fileList');
    const viewer = document.getElementById('mediaContent');
    let task = null;
    const observer = new MutationObserver(() => {
      if (task !== null) return;
      task = setTimeout(() => { task = null; inspectCurrentImages(); }, 180);
    });
    for (const root of [list, viewer]) {
      if (root) observer.observe(root, {childList:true, subtree:true});
    }
    setTimeout(inspectCurrentImages, 300);
    // Intercept transient errors after the app rebuilt its list.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(inspectCurrentImages, 250);
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', watchGallery);
  else watchGallery();

  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) {
      const img = event.target;
      if (img.dataset.vlFallback === 'running' || img.dataset.vlFallback === 'loaded') {
        img.dataset.vlFallback = 'failed';
        return;
      }
      const id = idFromDriveUrl(img.currentSrc || img.src);
      if (id) {
        event.stopImmediatePropagation();
        if (visibleObserver && !img.closest('#mediaContent')) visibleObserver.observe(img);
        else fallbackForImage(img);
      }
    }
  }, true);

  function trackClick(event) {
    const clickable = event.target.closest?.('[onclick*="openMedia"], [onclick*="openSearchResult"]');
    const source = clickable?.getAttribute('onclick') || '';
    const match = source.match(/open(?:Media|SearchResult)\s*\(\s*['"]([^'"]+)['"]/);
    if (match) lastClickedFile = match[1];
  }
  document.addEventListener('click', trackClick, true);

  async function showAuthenticatedMedia() {
    const id = lastClickedFile;
    const content = document.getElementById('mediaContent');
    if (!id || !content) {
      alert('Không nhận diện được file đang mở. Hãy mở lại từ danh sách.');
      return;
    }
    const button = document.getElementById('btnVLAuthenticatedPreview');
    if (button) button.disabled = true;
    try {
      let url;
      let isVideo = false;
      try {
        const token = await withDeadline(getToken(), 10000);
        const info = await withDeadline(metadata(id, token), 10000);
        isVideo = (info.mimeType || '').startsWith('video/');
        if (isVideo) {
          if (Number(info.size || 0) > MAX_VIDEO_BYTES)
            throw new Error('Video quá lớn để phát trực tiếp. Hãy mở qua Drive.');
          const blob = await authenticatedBlob(id, token);
          if (blob.size > MAX_VIDEO_BYTES) throw new Error('Video quá lớn');
          url = URL.createObjectURL(blob);
        } else {
          url = await imageFallback(id, true); // Includes Apps Script fallback.
        }
      } catch (error) {
        if (isVideo) throw error;
        url = await imageFallback(id, true);
      }
      content.innerHTML = '';
      const element = document.createElement(isVideo ? 'video' : 'img');
      element.src = url;
      element.className = 'max-w-full max-h-full object-contain';
      if (isVideo) { element.controls = true; element.playsInline = true; }
      content.appendChild(element);
      const viewer = document.getElementById('mediaViewer');
      viewer?.addEventListener('transitionend', () => {
        if (viewer.classList.contains('hidden')) URL.revokeObjectURL(url);
      }, {once:true});
    } catch (error) {
      if (typeof window.showToast === 'function') window.showToast(error.message, true);
      else alert(error.message);
    } finally { if (button) button.disabled = false; }
  }

  // An explicit viewer fallback helps when the built-in Drive preview iframe
  // fails silently (iframe load events do not reliably report authentication).
  function installViewerButton() {
    if (document.getElementById('btnVLAuthenticatedPreview')) return;
    const download = document.getElementById('btnDownloadCurrentMedia');
    if (!download) return;
    const button = document.createElement('button');
    button.id = 'btnVLAuthenticatedPreview';
    button.type = 'button';
    button.title = 'Xem ảnh/video bằng quyền QL Ảnh';
    button.setAttribute('aria-label', 'Xem bằng quyền QL Ảnh');
    button.className = 'text-xl p-2 mr-2 text-white';
    button.innerHTML = '<i class="fas fa-eye"></i>';
    download.parentElement?.insertBefore(button, download);
    button.addEventListener('click', () => { void showAuthenticatedMedia(); });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', installViewerButton);
  else installViewerButton();
})();