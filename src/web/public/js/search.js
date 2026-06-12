// search.js — Bloque 8.6
// Búsqueda global con overlay (Ctrl+K) que busca DENTRO del contenido de los
// mensajes, no solo en los títulos. Inspirado en el overlay de búsqueda de
// Odysseus, traducido a la marca. Endpoint: GET /api/search?q=
//
// Al elegir un resultado, salta a esa misión (ShinobiConvs.setActive).

(function () {
  'use strict';

  let $overlay, $input, $results, $foot;
  let timer = null;
  let selIdx = 0;
  let current = [];

  function grab() {
    $overlay = document.getElementById('search-overlay');
    $input = document.getElementById('search-global-input');
    $results = document.getElementById('search-results');
    $foot = document.getElementById('search-foot');
    return !!$overlay;
  }

  function open() {
    if (!$overlay && !grab()) return;
    $overlay.hidden = false;
    $input.value = '';
    $results.innerHTML = '';
    current = []; selIdx = 0;
    if ($foot) $foot.textContent = 'Busca dentro del rastro de cada misión.';
    setTimeout(() => $input.focus(), 40);
  }
  function close() { if ($overlay) $overlay.hidden = true; }

  function highlight(snippet, q) {
    const i = snippet.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return document.createTextNode(snippet);
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(snippet.slice(0, i)));
    const mark = document.createElement('mark');
    mark.textContent = snippet.slice(i, i + q.length);
    frag.appendChild(mark);
    frag.appendChild(document.createTextNode(snippet.slice(i + q.length)));
    return frag;
  }

  async function run(q) {
    if (!q.trim()) { $results.innerHTML = ''; current = []; if ($foot) $foot.textContent = 'Busca dentro del rastro de cada misión.'; return; }
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      current = Array.isArray(data.results) ? data.results : [];
      selIdx = 0;
      render(q);
    } catch {
      if ($foot) $foot.textContent = 'Sin red hacia el server local.';
    }
  }

  function render(q) {
    $results.innerHTML = '';
    if (current.length === 0) {
      if ($foot) $foot.textContent = 'Ningún rastro coincide.';
      return;
    }
    if ($foot) $foot.textContent = `${current.length} ${current.length === 1 ? 'misión' : 'misiones'} con rastro.`;
    current.forEach((res, i) => {
      const el = document.createElement('button');
      el.className = 'search-result' + (i === selIdx ? ' selected' : '');
      el.setAttribute('role', 'option');
      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = res.title || 'Misión';
      const snip = document.createElement('div');
      snip.className = 'search-result-snippet';
      snip.appendChild(highlight(res.snippet || '', q));
      el.appendChild(title); el.appendChild(snip);
      el.addEventListener('click', () => choose(i));
      $results.appendChild(el);
    });
  }

  function choose(i) {
    const res = current[i];
    if (!res) return;
    close();
    window.ShinobiConvs?.setActive?.(res.conversationId);
  }

  function move(d) {
    if (current.length === 0) return;
    selIdx = (selIdx + d + current.length) % current.length;
    render($input.value);
    const sel = $results.querySelector('.search-result.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!grab()) return;
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if ($overlay.hidden) open(); else close();
      }
      if (!$overlay.hidden && e.key === 'Escape') { e.preventDefault(); close(); }
    });
    $overlay.addEventListener('click', (e) => { if (e.target === $overlay) close(); });
    $input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => run($input.value), 180);
    });
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(selIdx); }
    });
  });

  window.ShinobiSearch = { open, close };
})();
