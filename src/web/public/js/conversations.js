// conversations.js — Bloque 8.2
// Manejo de la lista de conversaciones del sidebar:
//   · fetch al backend (GET /api/conversations)
//   · agrupación Hoy / Esta semana / Antes (computada en frontend)
//   · CRUD: crear, seleccionar, renombrar, borrar
//   · persistencia de la activa en localStorage ('shinobi.activeConv')
//
// Expone: window.ShinobiConvs = { init, refresh, getActive, setActive,
//                                 create, rename, remove, applyAutoTitle,
//                                 onChange, onSelect }

(function () {
  'use strict';

  const ACTIVE_KEY = 'shinobi.activeConv';
  let conversations = [];        // {id, title, created_at, last_active}[]
  let activeId = null;
  const listeners = { change: [], select: [] };

  function emit(evt, payload) {
    for (const cb of listeners[evt] || []) {
      try { cb(payload); } catch (e) { console.error('[convs] listener error', e); }
    }
  }
  function onChange(cb) { listeners.change.push(cb); }
  function onSelect(cb) { listeners.select.push(cb); }

  async function refresh() {
    try {
      const r = await fetch('/api/conversations');
      const data = await r.json();
      conversations = Array.isArray(data.conversations) ? data.conversations : [];
      render();
      emit('change', conversations);
    } catch (e) {
      console.error('[convs] refresh failed', e);
    }
  }

  async function create(opts = {}) {
    const r = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: opts.title || 'Conversación nueva' }),
    });
    const data = await r.json();
    if (data.conversation) {
      conversations.unshift(data.conversation);
      render();
      emit('change', conversations);
      setActive(data.conversation.id);
      return data.conversation;
    }
    return null;
  }

  async function rename(id, newTitle) {
    const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (r.ok) {
      const c = conversations.find(x => x.id === id);
      if (c) c.title = newTitle;
      render();
      emit('change', conversations);
    }
  }

  async function remove(id) {
    const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) {
      conversations = conversations.filter(c => c.id !== id);
      if (activeId === id) {
        activeId = conversations[0]?.id || null;
        if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
        else localStorage.removeItem(ACTIVE_KEY);
        emit('select', activeId);
      }
      render();
      emit('change', conversations);
    }
  }

  function getActive() {
    return conversations.find(c => c.id === activeId) || null;
  }

  function setActive(id) {
    if (!id || id === activeId) return;
    if (!conversations.find(c => c.id === id)) return;
    activeId = id;
    localStorage.setItem(ACTIVE_KEY, id);
    render();
    emit('select', id);
  }

  // Llamado desde el WS al recibir conversation_title_updated.
  function applyAutoTitle(id, title) {
    const c = conversations.find(x => x.id === id);
    if (!c) return;
    c.title = title;
    render();
    emit('change', conversations);
  }

  // ─── Agrupación temporal (Hoy / Esta semana / Antes) ──────────────────
  function bucketOf(isoDate) {
    if (!isoDate) return 'antes';
    const d = new Date(isoDate);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d >= startOfToday) return 'hoy';
    const weekAgo = new Date(startOfToday);
    weekAgo.setDate(weekAgo.getDate() - 6);
    if (d >= weekAgo) return 'semana';
    return 'antes';
  }

  function render() {
    const list = document.getElementById('conv-list');
    const empty = document.getElementById('conv-empty');
    if (!list) return;
    list.innerHTML = '';
    if (conversations.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    const grouped = { hoy: [], semana: [], antes: [] };
    for (const c of conversations) grouped[bucketOf(c.last_active)].push(c);

    const groupLabels = { hoy: 'Hoy', semana: 'Esta semana', antes: 'Antes' };
    for (const key of ['hoy', 'semana', 'antes']) {
      if (grouped[key].length === 0) continue;
      const label = document.createElement('div');
      label.className = 'conv-group-label';
      label.textContent = groupLabels[key];
      list.appendChild(label);
      for (const c of grouped[key]) {
        list.appendChild(renderItem(c));
      }
    }
  }

  function renderItem(c) {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === activeId ? ' active' : '');
    el.dataset.id = c.id;
    el.innerHTML = `
      <span class="conv-title-line" data-role="title"></span>
      <span class="conv-actions">
        <button class="icon-btn" data-action="rename" title="Renombrar" aria-label="Renombrar">
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M11 2 L14 5 L5 14 L2 14 L2 11 Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="icon-btn" data-action="delete" title="Borrar" aria-label="Borrar">
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3 4 L13 4 M5 4 L5 13 L11 13 L11 4 M6 7 L6 11 M10 7 L10 11 M6 4 L6 2 L10 2 L10 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </span>
    `;
    el.querySelector('[data-role="title"]').textContent = c.title;
    el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (btn) {
        ev.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'rename') {
          const next = prompt('Nuevo título:', c.title);
          if (next && next.trim()) rename(c.id, next.trim());
        } else if (action === 'delete') {
          if (confirm(`¿Borrar "${c.title}"? Los mensajes se perderán.`)) remove(c.id);
        }
        return;
      }
      setActive(c.id);
    });
    return el;
  }

  // ─── Búsqueda en cliente ──────────────────────────────────────────────
  function applyFilter(q) {
    const norm = q.trim().toLowerCase();
    const items = document.querySelectorAll('#conv-list .conv-item');
    let anyVisible = false;
    items.forEach(it => {
      const id = it.dataset.id;
      const c = conversations.find(x => x.id === id);
      const matches = !norm || (c && c.title.toLowerCase().includes(norm));
      it.style.display = matches ? '' : 'none';
      if (matches) anyVisible = true;
    });
    // ocultar labels cuyo grupo quedó sin items
    document.querySelectorAll('#conv-list .conv-group-label').forEach(lbl => {
      // El label es seguido de items hasta el siguiente label
      let sib = lbl.nextElementSibling;
      let anyInGroup = false;
      while (sib && !sib.classList.contains('conv-group-label')) {
        if (sib.classList.contains('conv-item') && sib.style.display !== 'none') { anyInGroup = true; break; }
        sib = sib.nextElementSibling;
      }
      lbl.style.display = anyInGroup ? '' : 'none';
    });
    return anyVisible;
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  async function init() {
    await refresh();
    // Si hay activeId guardado y existe en la lista, úsalo. Si no, primer item. Si no, crea una.
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved && conversations.find(c => c.id === saved)) {
      activeId = saved;
      render();
      emit('select', activeId);
    } else if (conversations.length > 0) {
      setActive(conversations[0].id);
    } else {
      const c = await create({ title: 'Conversación nueva' });
      if (c) setActive(c.id);
    }

    // Listeners UI
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => applyFilter(e.target.value));
    }
    document.getElementById('new-conv-btn')?.addEventListener('click', () => create());
    document.getElementById('new-conv-mini')?.addEventListener('click', () => create());

    // Ctrl/Cmd+K → focus search
    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
    });
  }

  window.ShinobiConvs = {
    init, refresh, getActive, setActive, create, rename, remove,
    applyAutoTitle, onChange, onSelect,
  };
})();
