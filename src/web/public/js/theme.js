// src/web/public/js/theme.js
//
// Bloque 8.1 — Theme switcher minimalista.
//
// API:
//   getTheme()          → 'sumi' | 'kintsugi' | 'aurora' | 'bushido'
//   setTheme(name)      → escribe data-theme + localStorage + emite 'themechange'
//   init()              → llamada en DOMContentLoaded por las páginas que opten in
//
// Persistencia: localStorage.getItem('shinobi.theme'). Default 'sumi'.

(function () {
  const STORAGE_KEY = 'shinobi.theme';
  const VALID = new Set(['sumi', 'kintsugi', 'aurora', 'bushido']);
  const DEFAULT = 'sumi';

  function getTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && VALID.has(v)) return v;
    } catch (_e) { /* ignore */ }
    return DEFAULT;
  }

  function setTheme(name) {
    if (!VALID.has(name)) return false;
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch (_e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: name } }));
    return true;
  }

  function init() {
    const t = getTheme();
    document.documentElement.setAttribute('data-theme', t);
  }

  // Expose on window for inline use in pages.
  window.ShinobiTheme = { getTheme, setTheme, init, VALID: [...VALID], DEFAULT };

  // Auto-init on DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
