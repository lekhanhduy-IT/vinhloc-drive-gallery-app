/* Cross-device media fallback for private Drive files.
   Prefer normal thumbnails, then a short-lived Drive thumbnailLink, then
   an authenticated in-memory Blob. Never make files public or store tokens. */
(() => {
  'use strict';
  if (window.__vlMediaFallbackInstalled) return;
  window.__vlMediaFallbackInstalled = true;
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  const MAX_OBJECT_URLS = 65;
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
    while (inflightCount < 3 && queue.length) {
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
  async function imageFallback(id) {
    const prior = saved.get(id);
    if (prior && Date.now() - prior.recordedAt < 20 * 60000) return prior.url;
    if (inflight.has(id)) return inflight.get(id);
    const task = enqueue(async () => {
      const token = await getToken();
      const file = await metadata(id, token);
      if (file.thumbnailLink) {
        try {
          const signed = await testImage(file.thumbnailLink);
          return remember(id, signed, false);
        } catch (_) {} // Google may require a new signed link or a different account.
      }
      const isImage = (file.mimeType || '').startsWith('image/');
      if (isImage && (!file.size || Number(file.size) <= MAX_IMAGE_BYTES)) {
        const blob = await authenticatedBlob(id, token);
        if (blob.size > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn để xem trực tiếp');
        return remember(id, URL.createObjectURL(blob), true);
      }
      if (!isImage && (file.mimeType || '').startsWith('video/') &&
          file.size && Number(file.size) <= MAX_VIDEO_BYTES) {
        const blob = await authenticatedBlob(id, token);
        const poster = await posterFromVideo(blob);
        return remember(id, poster, true);
      }
      throw new Error('Drive chưa tạo thumbnail hoặc tệp quá lớn');
    }).finally(() => inflight.delete(id));
    inflight.set(id, task);
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
    imageFallback(id).then(url => {
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
      img.alt = 'Không có thumbnail';
    });
  }
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
        fallbackForImage(img);
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
      const token = await getToken();
      const info = await metadata(id, token);
      const isVideo = (info.mimeType || '').startsWith('video/');
      const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (Number(info.size || 0) > max)
        throw new Error('Tệp lớn hơn ' + Math.floor(max / 1048576) + 'MB. Hãy mở qua Drive bằng tài khoản có quyền.');
      const blob = await authenticatedBlob(id, token);
      if (blob.size > max) throw new Error('Tệp quá lớn để xem trong trình duyệt');
      const url = URL.createObjectURL(blob);
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