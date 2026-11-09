/* Align the legacy "THƯ MỤC ĐÍCH DÁN" picker below the real app header.
 * No navigation, copy, move, selection or scroll behavior is changed. */
(() => {
  'use strict';
  if(window.__vlPastePopupPositionInstalled)return;
  window.__vlPastePopupPositionInstalled=true;

  function refresh(){
    const header=document.querySelector('body > header');
    if(!header)return;
    const rect=header.getBoundingClientRect();
    const bottom=Math.max(0,Math.ceil(rect.bottom));
    const value=bottom+'px';
    if(document.documentElement.style.getPropertyValue('--vl-paste-header-bottom')!==value){
      document.documentElement.style.setProperty('--vl-paste-header-bottom',value);
    }
  }

  function install(){
    refresh();
    const header=document.querySelector('body > header');
    if(header && 'ResizeObserver' in window){
      new window.ResizeObserver(refresh).observe(header);
    }
    // Capture before the legacy click handler shows the popup.
    document.addEventListener('pointerdown', event=>{
      if(event.target.closest?.('#pasteDestBtn'))refresh();
    },true);
    document.addEventListener('click', event=>{
      if(event.target.closest?.('#pasteDestBtn,#pastePopup'))refresh();
    },true);
    window.addEventListener('resize',refresh,{passive:true});
    window.addEventListener('orientationchange',refresh,{passive:true});
    window.visualViewport?.addEventListener('resize',refresh,{passive:true});
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
