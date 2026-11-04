/* Keep the sidebar footer asset consistent with the current design.
   Legacy script patches add the .vl-decor-footer node after page startup. */
(() => {
  'use strict';
  if (window.__vlFooterSidebarAssetInstalled) return;
  window.__vlFooterSidebarAssetInstalled = true;

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const source = 'new_footersidebar.png';

  function updateFooter() {
    for (const image of sidebar.querySelectorAll('.vl-decor-footer img')) {
      if (image.getAttribute('src') !== source) {
        image.setAttribute('src', source);
      }
    }
  }

  updateFooter();
  // React only to new footer elements or src replacements. Do not rebuild
  // the sidebar or alter layout, dimensions, or menu interactions.
  new MutationObserver(updateFooter).observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });
})();
