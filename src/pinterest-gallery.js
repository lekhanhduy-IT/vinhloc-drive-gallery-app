/* Original-aspect Pinterest masonry for the QL Ảnh file grid.
   Do not alter folder rows, native photo selection, list view or card actions. */
(() => {
  'use strict';
  if(window.__vlPinterestGallery)return;
  const grid=document.getElementById('fileList');
  if(!grid)return;
  window.__vlPinterestGallery=true;
  grid.classList.add('vl-pinterest');

  const ratioById=new Map();
  const observedImages=new WeakSet();
  const clamp=n=>Math.max(2,Math.min(6,Math.round(n)));
  const widthDefault=()=>window.innerWidth>=1024?6:
    window.innerWidth>=720?4:window.innerWidth>=520?3:2;
  const stored=()=>Number(localStorage.getItem('vinhloc_grid_cols')||0);
  const parseGridColumns=()=>{
    const match=(grid.style.gridTemplateColumns||'').match(/repeat\(\s*(\d+)\s*,/i);
    return match?clamp(Number(match[1])):0;
  };
  let inlineAtLastRead=grid.style.gridTemplateColumns;
  let customized=false;
  let current=stored()>2?clamp(stored()):widthDefault();
  // Legacy CSS displayed six desktop columns even with its internal "2"
  // setting. Keep that default, then honor later pinch/zoom changes.
  function setColumns(n){
    if(grid.classList.contains('list-view'))return;
    current=clamp(n);
    if(grid.style.getPropertyValue('--vl-pinterest-columns').trim()!==String(current))
      grid.style.setProperty('--vl-pinterest-columns',String(current));
  }
  function syncLegacyZoom(){
    const inline=grid.style.gridTemplateColumns;
    if(inline===inlineAtLastRead)return;
    inlineAtLastRead=inline;
    const parsed=parseGridColumns();
    if(parsed){customized=true;setColumns(parsed);}
  }
  function fileId(img){
    let card=img;
    while(card && card.parentElement!==grid)card=card.parentElement;
    if(!card)return '';
    const marker=card.querySelector('[id^="menu-"]');
    return marker?.id?.slice(5)||'';
  }
  function remember(img){
    if(!img.naturalWidth||!img.naturalHeight)return;
    const id=fileId(img);
    if(!id)return;
    const width=img.naturalWidth,height=img.naturalHeight;
    ratioById.set(id,{width,height});
    if(img.getAttribute('width')!==String(width))img.setAttribute('width',String(width));
    if(img.getAttribute('height')!==String(height))img.setAttribute('height',String(height));
  }
  function scan(){
    if(!grid.isConnected)return;
    for(const img of grid.querySelectorAll('img.drive-img-item')){
      if(observedImages.has(img))continue;
      observedImages.add(img);
      const id=fileId(img),ratio=ratioById.get(id);
      if(ratio){
        img.setAttribute('width',ratio.width);
        img.setAttribute('height',ratio.height);
      }
      img.addEventListener('load',()=>remember(img));
      if(img.complete&&img.naturalWidth)remember(img);
    }
  }
  function init(){
    inlineAtLastRead=grid.style.gridTemplateColumns;
    setColumns(current);
    scan();
  }
  // Old updateGridColumns() runs on DOMContentLoaded. Register after it.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
  let scheduled=false;
  const observer=new MutationObserver(mutations=>{
    const zoom=mutations.some(m=>m.type==='attributes' && m.target===grid && m.attributeName==='style');
    if(zoom)syncLegacyZoom();
    if(!scheduled){
      scheduled=true;
      requestAnimationFrame(()=>{scheduled=false;scan();});
    }
  });
  observer.observe(grid,{childList:true,subtree:true,attributes:true,attributeFilter:['style','src','class']});
  window.addEventListener('resize',()=>{
    if(!customized)setColumns(stored()>2?stored():widthDefault());
  },{passive:true});
  window.vlPinterestGallery={refresh:scan,columns:()=>current};
})();