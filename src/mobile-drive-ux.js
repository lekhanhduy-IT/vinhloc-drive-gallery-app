/* Mobile action bottom sheet + stable media tiles. */
(() => {
 'use strict';
 if(window.__vlMobileDriveUX)return;
 window.__vlMobileDriveUX=true;
 const mobile=()=>matchMedia('(max-width:767px)').matches;
 const style=document.createElement('style');
 style.textContent=`
 @media(max-width:767px){
 #fileList>div{min-width:0;contain:layout style;}
 #fileList>div .drive-img-name{overflow-wrap:anywhere;}
 #fileList>div img{display:block;width:100%;height:100%;object-fit:cover;}
 #fileList>div:has(img) :is(.relative,.overflow-hidden){min-width:0;}
 #fileList>div>div:first-child:has(img),#fileList>div .relative:has(>img){aspect-ratio:1 / 1;min-height:0;overflow:hidden;}
 #folderList img,.mega-header img,.subfolder-row img{object-fit:cover;}
 }
 #vlDriveSheetLayer{position:fixed;inset:0;z-index:2147482000;visibility:hidden;pointer-events:none;}
 #vlDriveSheetLayer.open{visibility:visible;pointer-events:auto;}
 #vlDriveSheetDim{position:absolute;inset:0;background:rgba(0,0,0,.42);opacity:0;transition:opacity .24s;}
 #vlDriveSheetLayer.open #vlDriveSheetDim{opacity:1;}
 #vlDriveSheet{position:absolute;left:0;right:0;bottom:0;max-height:85dvh;display:flex;flex-direction:column;border-radius:24px 24px 0 0;background:#fff;box-shadow:0 -12px 35px #0003;padding-bottom:max(14px,env(safe-area-inset-bottom));transform:translateY(105%);transition:transform .28s cubic-bezier(.2,.8,.2,1);overflow:hidden;}
 #vlDriveSheetLayer.open #vlDriveSheet{transform:translateY(0);}
 #vlSheetGrip{width:38px;height:5px;border-radius:6px;background:#cbd5e1;align-self:center;margin:10px 0;}
 #vlSheetHeading{display:flex;align-items:center;gap:12px;padding:6px 17px 12px;border-bottom:1px solid #e5e7eb;}
 #vlSheetTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f2937;font:600 15px system-ui;}
 #vlSheetClose{display:grid;place-items:center;width:38px;height:38px;flex:none;border:0;border-radius:50%;background:#fff1f2;color:#db1010;font:600 27px system-ui;cursor:pointer;}
 #vlSheetActions{overflow-y:auto;overscroll-behavior:contain;padding:6px 14px 10px;}
 #vlSheetActions>.item-action-menu,#vlSheetActions>#headerDropdown{display:block!important;position:static!important;inset:auto!important;transform:none!important;width:100%!important;min-width:0!important;max-width:none!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;border:0!important;border-radius:0!important;background:transparent!important;margin:0!important;opacity:1!important;visibility:visible!important;}
 #vlSheetActions>.item-action-menu>*,#vlSheetActions>#headerDropdown>*{min-height:48px;display:flex;align-items:center;width:100%;padding:10px 14px!important;font-size:15px!important;position:relative!important;}
 @media(prefers-reduced-motion:reduce){#vlDriveSheet,#vlDriveSheetDim{transition:none!important;}}
 `;
 document.head.appendChild(style);
 const layer=document.createElement('div');layer.id='vlDriveSheetLayer';
 layer.innerHTML='<div id="vlDriveSheetDim"></div><section id="vlDriveSheet" role="dialog" aria-modal="true" aria-label="Tùy chọn"><div id="vlSheetGrip"></div><div id="vlSheetHeading"><span id="vlSheetTitle">Tùy chọn</span><button id="vlSheetClose" type="button" aria-label="Đóng menu">×</button></div><div id="vlSheetActions"></div></section>';
 document.body.appendChild(layer);
 const slot=layer.querySelector('#vlSheetActions');
 let active=null,placeholder=null,closing=null,previousFocus=null;
 const close=()=>{
  if(!active)return;
  layer.classList.remove('open');
  document.body.classList.remove('vl-sheet-open');
  const original=active;
  active=null;
  setTimeout(()=>{
   if(placeholder?.parentNode){placeholder.replaceWith(original);original.classList.add('hidden');original.style.removeProperty('display');}
   else original.remove();
   placeholder=null;slot.replaceChildren();
   if(!active&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  },290);
 };
 layer.querySelector('#vlDriveSheetDim').addEventListener('click',close);
 layer.querySelector('#vlSheetClose').addEventListener('click',close);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();close();}},true);
 slot.addEventListener('click',e=>{if(e.target.closest('button,a,[onclick]'))setTimeout(close,0);});
 function open(menu,trigger){
  if(!mobile()||!menu)return;
  if(active) {const old=active;active=null;if(placeholder?.parentNode)placeholder.replaceWith(old);else old.remove();old.classList.add('hidden');}
  previousFocus=trigger;
  placeholder=document.createComment('vl mobile menu location');
  menu.parentNode.insertBefore(placeholder,menu);
  menu.classList.remove('hidden');
  slot.replaceChildren(menu);
  menu.style.setProperty('display','block','important');
  const item=trigger.closest('.subfolder-row,.mega-header,#fileList > div,#folderList > div');
  const name=item?.querySelector('.drive-img-name,[class*="item-name-"],.font-bold,.font-semibold')?.textContent?.trim();
  layer.querySelector('#vlSheetTitle').textContent=name?.slice(0,90)||'Tùy chọn';
  layer.classList.add('open');
 }
 if(window.vlMenuController?.onItem)window.vlMenuController.onItem(({menu})=>{
  if(mobile()&&!active){const trigger=document.querySelector('[aria-expanded="true"]')||document.activeElement;open(menu,trigger);}
 });
 // The item menu has already been toggled by legacy handler when this runs.
 document.addEventListener('click',e=>{
  if(!mobile()||active)return;
  const button=e.target.closest('button[onclick*="toggleItemMenu"],[onclick*="toggleItemMenu"]');
  if(!button)return;
  const match=button.getAttribute('onclick')?.match(/toggleItemMenu\(['"]([^'"]+)/);
  setTimeout(()=>{
   const menu=(match&&document.getElementById('menu-'+match[1]))||
    button.closest('.subfolder-row,.mega-header,#fileList > div,#folderList > div')?.querySelector('.item-action-menu:not(.hidden)');
   if(menu&&!menu.classList.contains('hidden'))open(menu,button);
  },0);
 },true);
 // Keep an image decoded and sized while the listing DOM is reconstructed.
 // Match by stable media id and scope to the same authenticated browser session.
 const known=new Map();
 const getKey=img=>{
  const url=img.getAttribute('src')||'';
  try{
   const u=new URL(url,location.href),id=u.searchParams.get('fileId')||u.searchParams.get('id');
   if(id&&/^[\w-]{10,160}$/.test(id))return id;
  }catch(_){}
  const row=img.closest('.subfolder-row,.mega-header,#folderList > div');
  const key=row?.querySelector('[class*="item-name-"]')?.className?.match(/item-name-([^ ]+)/)?.[1];
  return key||null;
 };
 const apply=img=>{
  if(!(img instanceof HTMLImageElement)||!img.isConnected)return;
  const key=getKey(img);
  if(!key)return;
  const old=known.get(key);
  if(old && old.src && img.getAttribute('src')!==old.src && !img.dataset.vlOriginalThumb){
   // Only reuse verified first-party media, not temporary signed URLs.
   const safe=old.src.startsWith('/api/media?')||old.src.startsWith(location.origin+'/api/media?');
   if(safe)img.src=old.src;
  }
  img.style.aspectRatio='1 / 1';
  img.style.objectFit='cover';
 };
 document.addEventListener('load',e=>{
  const img=e.target;
  if(!(img instanceof HTMLImageElement)||!img.naturalWidth)return;
  const key=getKey(img);
  if(key){
   known.delete(key);known.set(key,{src:img.getAttribute('src')||''});
   if(known.size>1000)known.delete(known.keys().next().value);
  }
 },true);
 const watch=new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes){
   if(node.nodeType!==1)continue;
   if(node.matches?.('img'))apply(node);
   node.querySelectorAll?.('img').forEach(apply);
  }
 });
 for(const id of ['folderList','fileList']){const el=document.getElementById(id);if(el)watch.observe(el,{childList:true,subtree:true});}
 document.querySelectorAll('#folderList img,#fileList img').forEach(apply);
 window.addEventListener('vl:account-role',()=>known.clear());
 window.addEventListener('storage',e=>{if(e.key==='vinhloc_authenticated_email')known.clear();});
})();
