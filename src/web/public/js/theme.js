// src/web/public/js/theme.js
//
// Bloque 8.3 — Theme switcher. Reemplaza las 4 paletas del 8.1 por
// solo Hiru (día) y Yoru (noche). Si localStorage tiene una paleta
// legacy (sumi/kintsugi/aurora/bushido), se mapea de forma sensata:
// las oscuras → yoru, bushido → hiru.
//
// API:
//   getTheme()      → 'hiru' | 'yoru'
//   setTheme(name)  → escribe data-theme + localStorage + emite 'themechange'
//   toggle()        → cambia entre hiru y yoru
//   init()          → llamada en DOMContentLoaded por las páginas que opten in
//
// Persistencia: localStorage.getItem('shinobi.theme'). Default 'hiru'.

(function () {
  const STORAGE_KEY = 'shinobi.theme';
  const VALID = new Set(['hiru', 'yoru']);
  const DEFAULT = 'hiru';

  // Mapeo de las paletas del 8.1 (que algún usuario tenga aún en localStorage)
  // a las dos del 8.3. Sin esto el theme volvería al default cada reload.
  const LEGACY_MAP = { sumi: 'yoru', kintsugi: 'yoru', aurora: 'yoru', bushido: 'hiru' };

  function getTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && VALID.has(v)) return v;
      if (v && LEGACY_MAP[v]) return LEGACY_MAP[v];
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

  function toggle() {
    setTheme(getTheme() === 'hiru' ? 'yoru' : 'hiru');
  }

  function init() {
    const t = getTheme();
    document.documentElement.setAttribute('data-theme', t);
    // Persistir el mapeo legacy si vino aplicable, para evitar relectura en cada init.
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && !VALID.has(stored)) localStorage.setItem(STORAGE_KEY, t);
    } catch (_e) { /* ignore */ }
  }

  window.ShinobiTheme = { getTheme, setTheme, toggle, init, VALID: [...VALID], DEFAULT };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
