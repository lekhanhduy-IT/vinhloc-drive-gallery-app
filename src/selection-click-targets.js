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
