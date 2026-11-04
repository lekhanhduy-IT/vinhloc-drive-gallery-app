/* Dim the gallery beneath the expanded addfolder.gif action menu.
   A separate backdrop stays BELOW the existing FAB so it never intercepts
   "Thêm thư mục", upload, capture, video, or editor controls. */
(() => {
  'use strict';
  if (window.__vlFabBackdropReady) return;
  const main=document.getElementById('fabMain');
  const menu=document.getElementById('fabMenu');
  if (!main || !menu) return;
  window.__vlFabBackdropReady=true;

  const backdrop=document.createElement('div');
  backdrop.id='vlFabBackdrop';
  backdrop.setAttribute('aria-hidden','true');
  document.body.appendChild(backdrop);
  main.setAttribute('aria-controls','fabMenu');

  function opened() {
    return !menu.classList.contains('hidden') &&
      (menu.classList.contains('flex') || getComputedStyle(menu).display!=='none');
  }
  function synchronize() {
    const active=opened();
    backdrop.classList.toggle('vl-fab-backdrop-open',active);
    main.setAttribute('aria-expanded',String(active));
  }
  function close() {
    if (!opened()) return;
    menu.classList.add('hidden');
    menu.classList.remove('flex');
    const icon=document.getElementById('fabIcon');
    if(icon)icon.style.transform='rotate(0deg)';
    synchronize();
  }

  backdrop.addEventListener('click',event=>{
    event.preventDefault();
    close();
  });
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape' && opened()) {
      event.preventDefault();
      close();
      main.focus();
    }
  });
  // Existing add/capture handlers must still receive their original clicks.
  window.addEventListener('click',event=>{
    const action=event.target?.closest?.('#fabMenu > button, #fabMenu > label');
    if (!action || !opened()) return;
    queueMicrotask(close);
  },true);

  new MutationObserver(synchronize).observe(menu,{
    attributes:true,attributeFilter:['class','style']
  });
  synchronize();
})();