/* v3.1.74: mobile native menu sheet. Never detach or clone actions.
   Existing click listeners, permission checks and Drive handlers stay in place. */
(() => {
 'use strict';
 if (window.__vlNativeMobileSheet) return;
 window.__vlNativeMobileSheet = true;
 const isMobile = () => matchMedia('(max-width:767px)').matches;
 const css = document.createElement('style');
 css.textContent = `
 #vlNativeSheetScrim{position:fixed;inset:0;background:rgba(0,0,0,.43);opacity:0;visibility:hidden;
   pointer-events:none;z-index:2147482100;transition:opacity .22s ease}
 #vlNativeSheetScrim.open{opacity:1;visibility:visible;pointer-events:auto}
 @media(max-width:767px){
  .vl-native-sheet-lift{position:relative!important;z-index:2147482400!important}
  .item-action-menu.vl-native-sheet,#headerDropdown.vl-native-sheet{
   box-sizing:border-box!important;display:block!important;position:fixed!important;
   left:0!important;right:0!important;top:auto!important;bottom:0!important;
   transform:translate3d(0,0,0)!important;margin:0!important;
   width:100vw!important;min-width:0!important;max-width:100vw!important;
   max-height:85dvh!important;overflow-y:auto!important;overflow-x:hidden!important;
   overscroll-behavior:contain!important;padding:0 16px max(12px,env(safe-area-inset-bottom))!important;
   background:#fff!important;border:0!important;border-radius:25px 25px 0 0!important;
   box-shadow:0 -12px 32px rgba(0,0,0,.18)!important;z-index:2147483000!important;
   opacity:1!important;visibility:visible!important;isolation:isolate!important;
   animation:vl-native-sheet-enter .25s cubic-bezier(.2,.7,.2,1) both!important
  }
  .vl-native-sheet-heading{box-sizing:border-box;display:flex;flex-direction:column;width:100%;
   gap:11px;padding:11px 0 12px;margin:0;border-bottom:1px solid #e5e7eb;
   background:white;position:sticky;top:0;z-index:4}
  .vl-native-sheet-grip{display:block;width:38px;height:5px;align-self:center;border-radius:10px;background:#cbd5e1}
  .vl-native-sheet-title-row{display:flex;align-items:center;gap:12px;min-height:48px}
  .vl-native-sheet-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
   white-space:nowrap;font:650 16px/1.35 system-ui;color:#1f2937}
  .vl-native-sheet-close{appearance:none!important;display:flex!important;justify-content:center!important;
   align-items:center!important;box-sizing:border-box!important;width:42px!important;
   min-width:42px!important;height:42px!important;min-height:42px!important;
   flex:0 0 42px!important;line-height:0!important;border-radius:50%!important;
   border:0!important;background:#fff1f2!important;color:#db1010!important;
   padding:0!important;margin:0!important;position:relative!important;
   cursor:pointer!important;transform:none!important}
  .vl-native-sheet-close svg{width:21px;height:21px;pointer-events:none;display:block}
  .item-action-menu.vl-native-sheet > :not(.vl-native-sheet-heading),
  #headerDropdown.vl-native-sheet > :not(.vl-native-sheet-heading){max-width:100%;box-sizing:border-box}
  .item-action-menu.vl-native-sheet button:not(.vl-native-sheet-close),
  #headerDropdown.vl-native-sheet button:not(.vl-native-sheet-close){min-height:44px}
  @keyframes vl-native-sheet-enter{
   from{opacity:.92;translate:0 100%}to{opacity:1;translate:0 0}
  }
 }
 @media(prefers-reduced-motion:reduce){
  .item-action-menu.vl-native-sheet,#headerDropdown.vl-native-sheet{animation:none!important}
  #vlNativeSheetScrim{transition:none}
 }
 `;
 document.head.appendChild(css);
 const scrim=document.createElement('div');scrim.id='vlNativeSheetScrim';
 document.body.appendChild(scrim);
 let current=null,heading=null,lifted=[],oldRole=null,lastTrigger=null;
 const idOk=id=>/^[A-Za-z0-9_-]{10,180}$/.test(String(id||''));
 function currentName(){
   try{
     const stack=typeof folderStack!=='undefined'?folderStack:window.folderStack;
     if(Array.isArray(stack)&&stack.length)return String(stack[stack.length-1].name||'').trim();
   }catch(_){}
   return document.getElementById('currentFolderName')?.textContent?.trim().split(/[›>]/).pop()?.trim()||'Thư mục hiện tại';
 }
 function itemName(id,menu){
   const row=menu.closest('.subfolder-row,.mega-header,.mega-row,#fileList > div,#folderList > div');
   const own=Array.from(row?.querySelectorAll('[class*="item-name-"],.drive-img-name')||[])
     .find(el=>Array.from(el.classList).some(cl=>cl==='item-name-'+id))||
     row?.querySelector('.drive-img-name,[class*="item-name-"]');
   if(own?.textContent?.trim())return own.textContent.trim();
   const all=document.querySelectorAll('#folderList [class*="item-name-"],#fileList [class*="item-name-"]');
   for(const el of all)if(el.classList.contains('item-name-'+id)&&el.textContent.trim())
     return el.textContent.trim();
   try{
     const items=typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems;
     const name=items?.find?.(it=>it.id===id)?.name;
     if(name)return String(name);
   }catch(_){}
   return 'Mục đã chọn';
 }
 function cleanup(){
   if(current?.isConnected){
     current.classList.remove('vl-native-sheet');
     current.classList.add('hidden');
     if(oldRole===null)current.removeAttribute('role');
     else current.setAttribute('role',oldRole);
     current.removeAttribute('aria-modal');
   }
   heading?.remove();heading=null;current=null;oldRole=null;
   for(const el of lifted)el.classList.remove('vl-native-sheet-lift');
   lifted=[];
   scrim.classList.remove('open');
   document.body.classList.remove('vl-native-sheet-active');
 }
 function close(){if(!current)return;cleanup();}
 scrim.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();close();});
 window.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&current){e.preventDefault();e.stopPropagation();close();}
 },true);
 // Keep native menu events on their original elements, not synthetic .click().
 // Schedule closing AFTER the existing delegated handlers get the real tap.
 window.addEventListener('click',e=>{
   if(!current || !current.contains(e.target))return;
   if(e.target.closest('.vl-native-sheet-close')){
     e.preventDefault();e.stopImmediatePropagation();close();return;
   }
   if(!e.target.closest('.vl-native-sheet-heading'))queueMicrotask(close);
 },true);
 window.addEventListener('resize',()=>{if(current&&!isMobile())close();},{passive:true});
 function open(menu,id,header=false){
   if(!isMobile()||!menu?.isConnected)return;
   if(current===menu)return;
   if(current)cleanup();
   // These are the very same menu nodes used on desktop. Their native
   // onclick/listener ancestry is untouched and ownership checks still run.
   oldRole=menu.getAttribute('role');
   const name=header?currentName():(idOk(id)?itemName(id,menu):'Mục đã chọn');
   const wrapper=document.createElement('div');
   wrapper.className='vl-native-sheet-heading';
   wrapper.innerHTML='<span class="vl-native-sheet-grip" aria-hidden="true"></span>'+
    '<div class="vl-native-sheet-title-row"><strong class="vl-native-sheet-title"></strong>'+
    '<button type="button" class="vl-native-sheet-close" aria-label="Đóng menu">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">'+
    '<path d="M5 5L19 19M19 5L5 19"></path></svg></button></div>';
   wrapper.querySelector('.vl-native-sheet-title').textContent=name;
   heading=wrapper;
   menu.prepend(wrapper);
   menu.classList.remove('hidden');
   menu.classList.add('vl-native-sheet');
   menu.setAttribute('role','dialog');
   menu.setAttribute('aria-modal','true');
   // Raise existing ancestors above the scrim without moving the menu.
   for(let el=menu.parentElement;el&&el!==document.body;el=el.parentElement){
     el.classList.add('vl-native-sheet-lift');
     lifted.push(el);
   }
   current=menu;
   scrim.classList.add('open');
   document.body.classList.add('vl-native-sheet-active');
 }
 window.vlMenuController?.onItem?.(({id,menu})=>open(menu,id,false));
 window.vlMenuController?.onHeader?.(({menu})=>open(menu,'',true));
 window.addEventListener('pagehide',close);
})();
