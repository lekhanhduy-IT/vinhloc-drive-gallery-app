/* Stable menu hooks: compose menu features in the same click turn, before paint.
   Later patches can reassign legacy functions without waiting for polling timers. */
(() => {
  'use strict';
  if (window.vlMenuController) return;
  const itemHooks = new Set();
  const headerHooks = new Set();
  // The delayed legacy header-decoration patch sets overflow:hidden,
  // cutting the dropdown until a much later patch reverses it.
  // Mark the actual app header as early as this controller loads.
  function markHeader() {
    const header = document.querySelector('header');
    header?.classList.add('vl-header-menu-host');
  }
  markHeader();

  function invoke(hooks, payload) {
    for (const hook of hooks) {
      try { hook(payload); }
      catch (error) { console.warn('[QL Anh] Menu decorator failed', error); }
    }
  }
  function itemMenu(id) {
    const menu = document.getElementById('menu-' + id);
    if (menu && !menu.classList.contains('hidden'))
      invoke(itemHooks, { id, menu });
  }
  function headerMenu() {
    markHeader();
    const menu = document.getElementById('headerDropdown');
    if (menu && !menu.classList.contains('hidden'))
      invoke(headerHooks, { menu });
  }
  function decorate(name, callback) {
    const previous = Object.getOwnPropertyDescriptor(window, name);
    let current;
    function wrap(fn) {
      if (typeof fn !== 'function' || fn.__vlStableMenuHook) return fn;
      const wrapped = function (...args) {
        const result = fn.apply(this, args);
        callback(args);
        return result;
      };
      // Preserve markers installed by the existing permission/legacy wrappers.
      for (const key of Reflect.ownKeys(fn)) {
        if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(key)) continue;
        try { Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)); }
        catch (_) {}
      }
      Object.defineProperty(wrapped, '__vlStableMenuHook', { value: true });
      return wrapped;
    }
    if (previous && !previous.configurable) {
      // Safe fallback for hosts exposing a non-configurable global.
      window[name] = wrap(window[name]);
      return;
    }
    current = wrap(window[name]);
    Object.defineProperty(window, name, {
      configurable: true, enumerable: previous?.enumerable ?? true,
      get() { return current; },
      set(next) { current = wrap(next); }
    });
  }

  decorate('toggleItemMenu', args => itemMenu(args[0]));
  decorate('buildHeaderMenu', () => headerMenu());
  decorate('toggleHeaderMenu', () => headerMenu());

  // Intercept the one header three-dot button before legacy DOM/inline
  // handlers can toggle it again. The menu is built before it becomes visible.
  window.addEventListener('click', event => {
    const trigger=event.target?.closest?.('#headerDropdownContainer > button[onclick*="toggleHeaderMenu"]');
    if(!trigger)return;
    const menu=trigger.parentElement?.querySelector('#headerDropdown');
    if(!menu)return;
    markHeader();
    event.preventDefault();
    event.stopImmediatePropagation();
    if(!menu.classList.contains('hidden')){
      menu.classList.add('hidden');
      return;
    }
    try { window.buildHeaderMenu?.(); }
    catch(error) { console.warn('[QL Ảnh] Không tạo được menu header',error); }
    menu.classList.remove('hidden');
    headerMenu(); // Synchronize permission-aware actions in this same click.
  }, true);

  window.vlMenuController = {
    onItem(handler) {
      if (typeof handler !== 'function') return () => {};
      itemHooks.add(handler);
      return () => itemHooks.delete(handler);
    },
    onHeader(handler) {
      if (typeof handler !== 'function') return () => {};
      headerHooks.add(handler);
      return () => headerHooks.delete(handler);
    },
    refreshVisible() {
      document.querySelectorAll('.item-action-menu[id^="menu-"]:not(.hidden)')
        .forEach(menu => invoke(itemHooks, { id: menu.id.slice(5), menu }));
      headerMenu();
    }
  };
})();
