/* Preserve folder metadata actions for Shared Drive members and admins.
   Guest share recipients never receive this legacy mutation modal. */
(() => {
  'use strict';
  if(window.__vlFolderInfoRestored)return;
  window.__vlFolderInfoRestored=true;
  const idRE=/^[A-Za-z0-9_-]{10,180}$/;
  function member(){
    const scope=window.vlShareScope;
    if(scope)return !!scope.ready?.()&&!!scope.member?.();
    return !window.__IS_GUEST &&
      !!localStorage.getItem('vinhloc_authenticated_email');
  }
  function findItem(id){
    let list;
    try{list=typeof currentDriveItems!=='undefined'?currentDriveItems:window.currentDriveItems;}
    catch(_){list=window.currentDriveItems;}
    return Array.isArray(list)?list.find(x=>x.id===id):null;
  }
  function restore(menu){
    if(!member()||!menu?.id?.startsWith('menu-'))return;
    const id=menu.id.slice(5);
    if(!idRE.test(id))return;
    const row=menu.closest('.mega-row,.subfolder-row');
    const item=findItem(id);
    const isFolder=item?.type==='folder'||
      (row&&row.querySelector('.fa-folder,.fa-folder-open,.fa-chevron-right'));
    if(!isFolder)return;
    let existing=Array.from(menu.children).find(x=>
      x.getAttribute?.('onclick')?.includes('openInfo(')||
      x.classList?.contains('vl-folder-info-item'));
    if(existing){
      // Some legacy guest hooks set inline display:none while the account
      // was being authenticated. Restore the native action for members.
      existing.style.removeProperty('display');
      existing.classList.remove('hidden');
      const text=Array.from(existing.childNodes).find(n=>n.nodeType===3&&
        n.nodeValue?.includes('Thông tin'));
      if(text)text.nodeValue='Thông tin folder';
      return;
    }
    const button=document.createElement('button');
    button.type='button';
    button.className='vl-folder-info-item vinhloc-safe-item';
    button.style.cssText='display:flex;width:100%;align-items:center;gap:12px;padding:12px 18px;color:#374151;font:600 14px system-ui;text-align:left;';
    const icon=document.createElement('i');icon.className='fas fa-info-circle text-blue-500';
    const label=document.createElement('span');label.textContent='Thông tin folder';
    button.append(icon,label);
    button.addEventListener('click',event=>{
      event.stopPropagation();event.preventDefault();
      menu.classList.add('hidden');
      if(typeof window.openInfo!=='function')return;
      const name=item?.name||
        row?.querySelector('[class*="item-name-"]')?.textContent?.trim()||'Thư mục';
      window.openInfo(id,name,'folder',row?.classList.contains('mega-row')?'mega':'sub',event);
    });
    menu.prepend(button);
  }
  function refresh(){
    if(!member())return;
    for(const menu of document.querySelectorAll('.item-action-menu[id^="menu-"]:not(.hidden)'))
      restore(menu);
  }
  document.addEventListener('click',()=>setTimeout(refresh,0),true);
  setInterval(refresh,1000);
  window.vlRestoreFolderInfoMenu=restore;
})();