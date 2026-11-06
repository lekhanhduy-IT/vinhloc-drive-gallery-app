/* Restore precise click targets for selection across normal and shared views.
   File name selects the file. Folder icon/thumbnail selects the folder.
   Other row surfaces retain their existing open/view behavior. */
(() => {
  'use strict';
  if (window.__vlSelectionClickTargets) return;
  window.__vlSelectionClickTargets = true;

  const prefixId=(node,prefix)=>{
    if (!node?.classList) return null;
    for (const value of node.classList) {
      if (value.startsWith(prefix)) {
        const id=value.slice(prefix.length);
        if (/^[A-Za-z0-9_-]{10,180}$/.test(id)) return id;
      }
    }
    return null;
  };

  function pickTarget(element) {
    if (!element?.closest) return null;
    // Avoid header, file action menus, dialogs and navigation buttons.
    if (element.closest('button,.item-action-menu,[role="dialog"],#infoModal,#customModal'))
      return null;

    const fileName=element.closest('#fileList .drive-img-name, #fileList [class*="item-name-"]');
    if (fileName)
      return {id:prefixId(fileName,'item-name-'),kind:'file'};

    const folderCover=element.closest(
      '#folderList [class*="item-cover-img-"], #folderList [class*="item-cover-icon-"]'
    );
    if (folderCover &&
        folderCover.closest('.subfolder-row,.mega-row'))
      return {
        id:prefixId(folderCover,'item-cover-img-') ||
           prefixId(folderCover,'item-cover-icon-'),
        kind:'folder'
      };
    return null;
  }

  // Window capture runs BEFORE the old shared-folder document capture listener,
  // which otherwise handles the same folder click a second time.
  window.addEventListener('click', event => {
    const chosen=pickTarget(event.target);
    if (!chosen?.id) return;
    if (typeof window.toggleFileSelection!=='function') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.toggleFileSelection(chosen.id,event);
  },true);

  // The legacy toggleFileSelection calls renderItems(currentDriveItems), which
  // reconstructs *every* file card via innerHTML on each selection click.
  // That discards loaded <img> nodes and visibly flashes the whole gallery.
  // Patch only the clicked file card; leave real data renders untouched.
  function visibleFileCard(id) {
    const list=document.getElementById('fileList');
    if (!list || list.classList.contains('list-view')) return null;
    const menu=document.getElementById('menu-'+id);
    if (!menu || !list.contains(menu)) return null;
    let card=menu;
    while (card && card.parentElement!==list) card=card.parentElement;
    return card?.parentElement===list ? card : null;
  }
  function updateVisibleFileSelection(card, selected) {
    if (!card) return;
    card.classList.toggle('ring-2',selected);
    card.classList.toggle('ring-blue-500',selected);
    card.classList.toggle('bg-blue-50',selected);
    card.classList.toggle('bg-white',!selected);
    card.classList.toggle('border-gray-100',!selected);

    const caption=Array.from(card.children).find(el=>el.classList?.contains('px-1'));
    const title=caption?.querySelector('.drive-img-name');
    if (title) {
      title.classList.toggle('text-blue-700',selected);
      title.classList.toggle('text-gray-800',!selected);
    }

    // Reuse the original renderer's check element if one already exists.
    // Never replace the preview image, card, menu button or name node.
    const badges=Array.from(card.children).filter(el=>
      el.classList?.contains('absolute') &&
      el.classList?.contains('top-2') &&
      el.classList?.contains('left-2') &&
      el.querySelector('.fa-check'));
    if (selected && !badges.length) {
      const badge=document.createElement('div');
      badge.className='absolute top-2 left-2 z-20 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md vl-selection-check';
      badge.innerHTML='<i class="fas fa-check text-xs" aria-hidden="true"></i>';
      badge.setAttribute('aria-hidden','true');
      card.appendChild(badge);
    } else if (!selected) {
      for(const badge of badges) badge.remove();
    }
    card.dataset.vlSelected=selected?'true':'false';
  }
  function installSelectionWithoutRedraw(){
    const prior=window.toggleFileSelection;
    if (typeof prior!=='function' || prior.__vlSelectionWithoutRedraw) return;
    const stable=function(id,event){
      const card=visibleFileCard(id);
      const state=window.multiSelectState?.selectedIds;
      // List view, folder rows and unusual legacy views keep old semantics.
      if (!card || !(state instanceof Set))
        return prior.apply(this,arguments);
      event?.stopPropagation?.();
      const selected=!state.has(id);
      if (selected) state.add(id);
      else state.delete(id);
      updateVisibleFileSelection(card,selected);
      const menu=document.getElementById('headerDropdown');
      if(menu && !menu.classList.contains('hidden') &&
         typeof window.buildHeaderMenu==='function')
        window.buildHeaderMenu();
      if(typeof window.updatePasteButtonState==='function')
        window.updatePasteButtonState();
      return undefined;
    };
    stable.__vlSelectionWithoutRedraw=true;
    window.toggleFileSelection=stable;
  }
  installSelectionWithoutRedraw();
  // The original bundle initializes several delayed compatibility patches.
  // Reapply only if one of those patches replaces the click handler.
  window.addEventListener('load',installSelectionWithoutRedraw,{once:true});

  const css=document.createElement('style');
  css.id='vl-selection-click-style';
  css.textContent=
    '#fileList .drive-img-name, #fileList [class*="item-name-"],'+
    '#folderList .subfolder-row [class*="item-cover-img-"],'+
    '#folderList .subfolder-row [class*="item-cover-icon-"],'+
    '#folderList .mega-row [class*="item-cover-img-"],'+
    '#folderList .mega-row [class*="item-cover-icon-"]{cursor:pointer;}';
  document.head.appendChild(css);
})();
