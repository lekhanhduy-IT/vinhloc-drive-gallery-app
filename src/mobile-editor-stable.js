/* iOS editor: keep image nodes mounted while slider/touch events update styles.
   The legacy updateProp/updateFilter calls renderImages(), clearing the whole
   image-grid on every input and triggering Safari image reload/flicker. */
(() => {
  'use strict';
  if (window.__vlStableMobileEditor) return;
  const mobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!mobile) return;
  window.__vlStableMobileEditor = true;
  const editor = document.getElementById('watermark-overlay-container');
  const grid = document.getElementById('image-grid');
  if (!editor || !grid) return;
  let queued = false;
  let activeTouch = false;
  let preventRepeat = 0;
  const getState = () => window.state || null;
  function targets(state) {
    if (typeof window.getTargetImages === 'function') return window.getTargetImages();
    const selected = state.images.filter(x => x.selected);
    return selected.length ? selected : state.images;
  }
  function layerElement(card, data, state, layerId) {
    const layers = state.layerOrder.filter(layer =>
      (layer.type === 'text' ? data.texts : data.wms).some(item => item.id === layer.id));
    const index = layers.findIndex(layer => layer.id === layerId);
    return index >= 0 ? card.querySelectorAll('.overlay-item')[index] : null;
  }
  function updateOverlay(node, item, type) {
    if (!node || !item) return;
    node.style.left = item.x + '%';
    node.style.top = item.y + '%';
    node.style.opacity = String(Number(item.opacity ?? 100) / 100);
    node.style.transform = 'translate(-50%,-50%) rotate('+(Number(item.rotation)||0)+'deg)';
    if (type === 'text') {
      node.style.fontSize = Number(item.scale || 30) / 5 + 'cqw';
      node.style.color = item.color || '#ffffff';
      node.style.fontFamily = item.fontFamily || 'Roboto';
      node.style.fontWeight = item.fontWeight || 'normal';
      node.style.fontStyle = item.fontStyle || 'normal';
      node.style.textShadow = item.textShadow || 'none';
      node.style.webkitTextStroke = item.stroke && item.stroke !== 'transparent' ?
        '4px ' + item.stroke : '0px transparent';
      const span = node.querySelector('span');
      if (span && span.textContent !== String(item.val ?? '')) span.textContent = String(item.val ?? '');
    } else {
      node.style.width = Number(item.scale || 30) + '%';
      const img = node.querySelector('img.overlay-img');
      if (img && item.src && img.getAttribute('src') !== item.src) img.src = item.src;
    }
  }
  function updateImage(card, data) {
    const img = card?.querySelector('img.base-img');
    if (!img) return;
    const bright = Number(data.filterBrightness || 100) - Number(data.filterDarkness || 0);
    const contrast = Number(data.filterContrast || 100) + Number(data.filterSharpness || 0) / 2;
    img.style.filter='brightness('+bright+'%) contrast('+contrast+'%) saturate('+
      Number(data.filterSaturate || 100)+'%)';
    const rotate = Number(data.filterRotate || 0);
    img.style.transform='rotate('+rotate+'deg) scale('+(1+Math.abs(rotate)/90*0.4)+')';
    img.style.objectPosition = (data.panX ?? 50)+'% '+(data.panY ?? 50)+'%';
  }
  function paint() {
    queued = false;
    const state = getState();
    if (!state || editor.style.display === 'none') return;
    for (const data of state.images) {
      const card = Array.from(grid.children).find(x => x.dataset?.id === data.id);
      if (!card) continue;
      updateImage(card,data);
      for (const layer of state.layerOrder) {
        const item=(layer.type==='text' ? data.texts : data.wms).find(x=>x.id===layer.id);
        if (item) updateOverlay(layerElement(card,data,state,layer.id),item,layer.type);
      }
    }
  }
  function schedule() {
    if (queued) return;
    queued=true;
    requestAnimationFrame(paint);
  }
  const originalProp=window.updateProp;
  const originalFilter=window.updateFilter;
  if (typeof originalProp !== 'function' || typeof originalFilter !== 'function') return;
  window.updateProp = function(key,value) {
    const state = getState();
    if (!state || !Array.isArray(state.images) || editor.style.display === 'none')
      return originalProp.apply(this,arguments);
    const numeric = ['scale','x','y','opacity','rotation'].includes(key);
    const normalized = numeric ? Number(value) : value;
    if (numeric && !Number.isFinite(normalized)) return;
    for (const data of targets(state)) {
      const list = state.activeEditTarget === 'text' ? data.texts : data.wms;
      for (const item of list) {
        if (!state.activeElementId || state.activeElementId === item.id) item[key] = normalized;
      }
    }
    schedule();
  };
  window.updateFilter = function(key,value) {
    const state = getState();
    if (!state || !Array.isArray(state.images) || editor.style.display === 'none')
      return originalFilter.apply(this,arguments);
    const number=Number(value);
    if (!Number.isFinite(number)) return;
    for (const data of targets(state)) data[key]=number;
    schedule();
  };
  // Capture the gesture on touchstart and suppress the legacy element's
  // touchend listener unconditionally at the GRID capture phase. The previous
  // code looked up event.target during touchend; on iOS the final target can
  // be a control or blank card after finger movement, so the old listener
  // still ran renderImages() and discarded every live image element.
  let dragContext = null;
  grid.addEventListener('touchstart',event=>{
    const overlay=event.target.closest?.('.overlay-item');
    const card=event.target.closest?.('.image-card');
    if(!overlay || !card || !overlay.closest('#image-grid')) {
      dragContext=null; return;
    }
    const state=getState();
    const data=state?.images.find(x=>x.id===card.dataset.id);
    if(!data) return;
    const index=Array.from(card.querySelectorAll('.overlay-item')).indexOf(overlay);
    const layers=state.layerOrder.filter(layer=>
      (layer.type==='text'?data.texts:data.wms).some(item=>item.id===layer.id));
    dragContext={cardId:data.id,layer:layers[index]||null,overlay};
  },true);
  function finishGesture(event) {
    if(!dragContext)return;
    const ctx=dragContext;
    dragContext=null;
    // Stop the iOS gesture from reaching the old touchend handler, which
    // triggers a full grid rebuild. Touchstart/move already updated the model.
    event.stopImmediatePropagation();
    event.stopPropagation();
    const state=getState();
    const data=state?.images.find(x=>x.id===ctx.cardId);
    if(!data||!ctx.layer)return;
    const list=ctx.layer.type==='text'?data.texts:data.wms;
    const current=list.find(x=>x.id===ctx.layer.id);
    if(!current)return;
    for(const other of targets(state)){
      if(other===data)continue;
      const copy=(ctx.layer.type==='text'?other.texts:other.wms)
        .find(x=>x.id===ctx.layer.id);
      if(!copy)continue;
      for(const p of ['x','y','scale','rotation'])copy[p]=current[p];
    }
    schedule();
  }
  grid.addEventListener('touchend',finishGesture,true);
  grid.addEventListener('touchcancel',finishGesture,true);
  const style=document.createElement('style');
  style.textContent = '@media (pointer:coarse) {'+
    '#watermark-overlay-container .overlay-item,'+
    '#watermark-overlay-container .ctrl-btn{touch-action:none!important;-webkit-user-select:none;user-select:none;}'+
    '#watermark-overlay-container .image-card img.base-img{-webkit-transform:translateZ(0);backface-visibility:hidden;}'+
    '#watermark-overlay-container .slider-row input[type=range]{touch-action:pan-x;}'+
    '}';
  document.head.appendChild(style);
  // When the editor opens, keep existing image instances and let only new
  // navigation/selection changes deliberately render a fresh grid.
  window.vlStableEditorRepaint=schedule;
})();