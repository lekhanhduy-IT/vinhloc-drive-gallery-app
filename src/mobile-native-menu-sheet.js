/* v3.1.75: native iOS/Android bottom sheet using the browser top layer.
   Use the REAL original menu node without moving or cloning it.
   This avoids reparenting bugs and prevents sibling rows from rising above
   the backdrop or the three-dot button from shifting. */
(() => {
 'use strict';
 if(window.__vlNativeMobileSheet)return;
 window.__vlNativeMobileSheet=true;
 const mobile=()=>matchMedia('(max-width:767px)').matches;
 const stylesheet=document.createElement('style');
 stylesheet.id='vl-native-mobile-sheet-css';
 stylesheet.textContent=String.raw`
 @media(max-width:767px){
  html:has(.vl-native-sheet:popover-open),
  body:has(.vl-native-sheet:popover-open){overscroll-behavior:contain}
  .item-action-menu.vl-native-sheet:popover-open,
  #headerDropdown.vl-native-sheet:popover-open{
   display:block!important;visibility:visible!important;opacity:1!important;
   position:fixed!important;box-sizing:border-box!important;
   inset:auto 0 0 0!important;top:auto!important;bottom:0!important;
   left:0!important;right:0!important;
   width:100vw!important;min-width:0!important;max-width:100vw!important;
   height:auto!important;max-height:min(85dvh,850px)!important;
   overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;
   transform:none!important;translate:0 0!important;
   padding:0 16px max(14px,env(safe-area-inset-bottom,0px))!important;
   margin:0!important;border:0!important;border-radius:24px 24px 0 0!important;
   box-shadow:0 -12px 35px rgba(0,0,0,.16)!important;
   background:#fff!important;color:#1f2937!important;
   isolation:isolate!important;z-index:2147483000!important;
   animation:vl-native-sheet-enter .24s cubic-bezier(.2,.7,.2,1) both!important
  }
  .vl-native-sheet:popover-open::backdrop{
   background:rgba(0,0,0,.46)!important;
   backdrop-filter:none!important;
  }
  .vl-native-sheet-heading{
   box-sizing:border-box;position:sticky;top:0;z-index:5;
   width:100%;display:flex;flex-direction:column;gap:10px;
   margin:0;padding:12px 0 14px;border-bottom:1px solid #e5e7eb;background:#fff
  }
  .vl-native-sheet-grip{width:39px;height:5px;border-radius:8px;
   align-self:center;background:#cbd5e1;display:block}
  .vl-native-sheet-title-row{display:flex;align-items:center;gap:12px;min-height:46px}
  .vl-native-sheet-title{
   min-width:0;flex:1;max-width:100%;overflow:hidden;text-overflow:ellipsis;
   white-space:nowrap;font:650 16px/1.35 system-ui;color:#1f2937
  }
  .vl-native-sheet-close{
   appearance:none!important;display:flex!important;align-items:center!important;
   justify-content:center!important;box-sizing:border-box!important;
   width:44px!important;min-width:44px!important;
   height:44px!important;min-height:44px!important;
   flex:0 0 44px!important;position:relative!important;
   padding:0!important;margin:0!important;transform:none!important;
   border:0!important;border-radius:50%!important;line-height:0!important;
   background:#fff1f2!important;color:#db1010!important;
   box-shadow:none!important;cursor:pointer!important
  }
  .vl-native-sheet-close svg{display:block!important;width:21px!important;
   height:21px!important;pointer-events:none}
  .vl-native-sheet:popover-open button:not(.vl-native-sheet-close){
   min-height:42px
  }
  @keyframes vl-native-sheet-enter{
   from{opacity:.97;translate:0 100%}to{opacity:1;translate:0 0}
  }
 }
 @media(prefers-reduced-motion:reduce){
  .vl-native-sheet:popover-open{animation:none!important}
 }
`;
 document.head.appendChild(stylesheet);

 const fileIdOk=/^[A-Za-z0-9_-]{10,180}$/;
 let active=null,heading=null,oldRole=null,oldPopover=null,observer=null,openedBy=null;
 function folderName(){
  try{
   const stack=typeof folderStack!=='undefined'?folderStack:window.folderStack;
   if(Array.isArray(stack)&&stack.length)
    return String(stack[stack.length-1].name||'').trim();
  }catch(_){}
  const raw=document.getElementById('currentFolderName')?.textContent?.trim()||'';
  return raw.split(/[›>]/).pop()?.trim()||'Thư mục hiện tại';
 }
 function itemName(id,menu){
  const card=menu.closest('.subfolder-row,.mega-header,.mega-row,#fileList > div,#folderList > div');
  const local=card?.querySelector('.drive-img-name,.font-bold,.font-semibold,[class*="item-name-"]');
  if(local?.textContent?.trim())return local.textContent.trim();
  for(const e of document.querySelectorAll('#folderList [class*="item-name-"],#fileList [class*="item-name-"]'))
   if(e.classList.contains('item-name-'+id)&&e.textContent.trim())return e.textContent.trim();
  try{
   const arr=typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems;
   const item=arr?.find?.(x=>x.id===id);
   if(item?.name)return String(item.name);
  }catch(_){}
  return 'Mục đã chọn';
 }
 function cleanup(){
  const menu=active;
  observer?.disconnect();observer=null;
  active=null;
  if(menu){
   if(menu.matches?.(':popover-open')){
    try{menu.hidePopover();}catch(_){}
   }
   menu.classList.remove('vl-native-sheet');
   menu.classList.add('hidden');
   if(oldPopover===null)menu.removeAttribute('popover');
   else menu.setAttribute('popover',oldPopover);
   if(oldRole===null)menu.removeAttribute('role');
   else menu.setAttribute('role',oldRole);
   menu.removeAttribute('aria-modal');
  }
  heading?.remove();heading=null;oldPopover=null;oldRole=null;
  if(openedBy?.isConnected){
   try{openedBy.focus({preventScroll:true})}catch(_){}
  }
  openedBy=null;
 }
 function close(){if(active)cleanup();}
 window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&active){e.preventDefault();e.stopPropagation();close();}
 },true);
 // Backdrop receives pointer events with the popover itself as target.
 window.addEventListener('pointerdown',e=>{
  if(!active)return;
  const rect=active.getBoundingClientRect();
  if(e.target===active &&
    (e.clientY<rect.top || e.clientY>rect.bottom ||
     e.clientX<rect.left || e.clientX>rect.right)){
   e.preventDefault();e.stopPropagation();close();
  }
 },true);
 // Window capture delegates all real menu actions untouched.
 window.addEventListener('click',e=>{
  if(!active)return;
  if(e.target.closest?.('.vl-native-sheet-close')&&active.contains(e.target)){
   e.preventDefault();e.stopImmediatePropagation();close();return;
  }
  if(!active.contains(e.target))return;
  if(e.target.closest?.('.vl-native-sheet-heading'))return;
  const menu=active;
  queueMicrotask(()=>{if(active===menu)close();});
 },true);
 // Some owner-action handlers stop propagation at window capture.
 // Pointerup is separate from click, so it still closes after their action.
 window.addEventListener('pointerup',e=>{
  if(!active||!active.contains(e.target)||
    e.target.closest?.('.vl-native-sheet-heading'))return;
  const menu=active;
  setTimeout(()=>{if(active===menu)close();},250);
 },true);
 window.addEventListener('resize',()=>{
  if(active&&!mobile())close();
 },{passive:true});
 function open(menu,id,header=false){
  if(!mobile()||!menu?.isConnected)return;
  if(typeof menu.showPopover!=='function')return;
  if(active===menu)return;
  if(active)close();
  openedBy=document.activeElement;
  oldRole=menu.getAttribute('role');
  oldPopover=menu.getAttribute('popover');
  const label=header?folderName():fileIdOk.test(id||'')?itemName(id,menu):'Mục đã chọn';
  const head=document.createElement('div');
  head.className='vl-native-sheet-heading';
  const grip=document.createElement('span');grip.className='vl-native-sheet-grip';
  grip.setAttribute('aria-hidden','true');
  const titleRow=document.createElement('div');titleRow.className='vl-native-sheet-title-row';
  const title=document.createElement('strong');title.className='vl-native-sheet-title';
  title.textContent=label;
  const closeButton=document.createElement('button');
  closeButton.type='button';closeButton.className='vl-native-sheet-close';
  closeButton.setAttribute('aria-label','Đóng menu');
  closeButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 5L19 19M19 5L5 19"></path></svg>';
  titleRow.append(title,closeButton);head.append(grip,titleRow);
  menu.prepend(head);heading=head;
  menu.classList.remove('hidden');
  menu.classList.add('vl-native-sheet');
  menu.setAttribute('popover','manual');
  menu.setAttribute('role','dialog');
  menu.setAttribute('aria-modal','true');
  try{menu.showPopover();}
  catch(error){
   console.warn('[QL Ảnh] Không mở được menu mobile',error);
   menu.classList.remove('vl-native-sheet');head.remove();heading=null;
   if(oldPopover===null)menu.removeAttribute('popover');else menu.setAttribute('popover',oldPopover);
   if(oldRole===null)menu.removeAttribute('role');else menu.setAttribute('role',oldRole);
   menu.removeAttribute('aria-modal');
   return;
  }
  active=menu;
  observer=new MutationObserver(()=>{
   if(active!==menu)return;
   if(!menu.isConnected||menu.classList.contains('hidden')||
      !menu.matches(':popover-open'))close();
  });
  observer.observe(menu,{attributes:true,attributeFilter:['class','popover'],childList:true});
  menu.addEventListener('toggle',e=>{
   if(e.newState==='closed'&&active===menu)close();
  },{once:true});
 }
 window.vlMenuController?.onItem?.(({id,menu})=>open(menu,id,false));
 window.vlMenuController?.onHeader?.(({menu})=>open(menu,'',true));
 window.addEventListener('pagehide',close);
})();
