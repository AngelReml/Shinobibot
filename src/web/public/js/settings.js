// settings.js — Bloque 8.6
// Panel de Ajustes unificado + selector de modelo del header. Inspirado en la
// organización del panel de settings de Odysseus (nav vertical por secciones,
// gestor de proveedores, selector de modelo), traducido a la marca: tinta y
// papel, sin logos de librería (§12.1, Tabla 16). Todo lee/escribe el estado
// real del backend — la selva no miente.
//
// Endpoints: /api/providers, /api/models, /api/model, /api/approval,
//            /api/providers/test, /api/onboarding, /api/status

(function () {
  'use strict';

  let providers = [];
  let models = [];
  let activeModel = 'auto';

  // ─── refs ─────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Modelo: selector del header ───────────────────────────────────────
  function shortModel(m) {
    if (!m || m === 'default' || m === 'auto') return 'auto';
    const slash = m.lastIndexOf('/');
    return slash >= 0 ? m.slice(slash + 1) : m;
  }

  async function loadModels() {
    try {
      const r = await fetch('/api/models');
      if (!r.ok) return;
      const data = await r.json();
      models = Array.isArray(data.models) ? data.models : [];
      activeModel = data.active || 'auto';
      renderModelLabel();
    } catch { /* silencio */ }
  }

  function renderModelLabel() {
    const lbl = $('model-picker-label');
    if (lbl) lbl.textContent = shortModel(activeModel);
  }

  function renderModelMenu() {
    const menu = $('model-picker-menu');
    if (!menu) return;
    menu.innerHTML = '';
    for (const m of models) {
      const item = document.createElement('button');
      item.className = 'model-opt' + ((m.id === activeModel || (m.id === 'auto' && (activeModel === 'auto' || activeModel === 'default'))) ? ' active' : '');
      item.setAttribute('role', 'option');
      item.innerHTML = `<span class="model-opt-name font-code-ui"></span><span class="model-opt-tier font-code-ui"></span>`;
      item.querySelector('.model-opt-name').textContent = m.label || m.id;
      item.querySelector('.model-opt-tier').textContent = m.tier && m.tier !== '—' ? m.tier : '';
      item.addEventListener('click', () => { setModel(m.id); closeModelMenu(); });
      menu.appendChild(item);
    }
  }

  async function setModel(id) {
    try {
      const r = await fetch('/api/model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id }),
      });
      const data = await r.json();
      activeModel = data.active || id;
      renderModelLabel();
      renderModelMenu();
      renderSettingsModels();
      window.ShinobiToast?.(`Modelo · ${shortModel(activeModel)}`, 'Override activo. Bypassa el router.');
    } catch { /* silencio */ }
  }

  function openModelMenu() {
    const menu = $('model-picker-menu'); const btn = $('model-picker-btn');
    if (!menu) return;
    renderModelMenu();
    menu.hidden = false;
    btn?.setAttribute('aria-expanded', 'true');
  }
  function closeModelMenu() {
    const menu = $('model-picker-menu'); const btn = $('model-picker-btn');
    if (menu) menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
  }

  // ── Panel de Ajustes ──────────────────────────────────────────────────
  function openSettings(tab) {
    const m = $('settings-modal');
    if (!m) return;
    m.hidden = false;
    if (tab) switchTab(tab);
    refreshAll();
  }
  function closeSettings() { const m = $('settings-modal'); if (m) m.hidden = true; }

  function switchTab(tab) {
    document.querySelectorAll('.settings-nav-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.settings-tab').forEach((s) =>
      s.classList.toggle('active', s.dataset.panel === tab));
  }

  async function refreshAll() {
    await Promise.all([refreshProviders(), loadModels()]);
    renderSettingsModels();
    await refreshStatusInto();
  }

  // Proveedores
  async function refreshProviders() {
    try {
      const r = await fetch('/api/providers');
      if (!r.ok) return;
      const data = await r.json();
      providers = Array.isArray(data.providers) ? data.providers : [];
      const wrap = $('settings-providers');
      const sel = $('settings-provider-select');
      if (wrap) {
        wrap.innerHTML = '';
        for (const p of providers) {
          const row = document.createElement('div');
          row.className = 'provider-row' + (p.active ? ' active' : '');
          row.innerHTML = `<span class="provider-name"></span>`
            + `<span class="provider-meta font-code-ui"></span>`;
          row.querySelector('.provider-name').textContent = p.label;
          row.querySelector('.provider-meta').textContent = p.active ? 'en uso' : p.defaultModel;
          wrap.appendChild(row);
        }
      }
      if (sel) {
        sel.innerHTML = '';
        for (const p of providers) {
          const opt = document.createElement('option');
          opt.value = p.name; opt.textContent = p.label;
          if (p.active) opt.selected = true;
          sel.appendChild(opt);
        }
      }
    } catch { /* silencio */ }
  }

  function settingsMsg(text, kind) {
    const el = $('settings-key-msg');
    if (!el) return;
    el.hidden = false;
    el.className = 'settings-msg ' + (kind || 'info');
    el.textContent = text;
  }

  async function testKey() {
    const provider = $('settings-provider-select')?.value;
    const key = $('settings-key')?.value.trim();
    if (!provider || !key) { settingsMsg('Elige proveedor y pega la key.', 'error'); return; }
    settingsMsg('Probando la key con el proveedor…', 'info');
    try {
      const r = await fetch('/api/providers/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      const data = await r.json();
      if (data.ok) settingsMsg('Key válida. Lista para guardar.', 'ok');
      else settingsMsg(data.error || 'La key no validó.', 'error');
    } catch (e) { settingsMsg('Sin red hacia el server local.', 'error'); }
  }

  async function saveKey() {
    const provider = $('settings-provider-select')?.value;
    const key = $('settings-key')?.value.trim();
    if (!provider || !key) { settingsMsg('Elige proveedor y pega la key.', 'error'); return; }
    settingsMsg('Guardando y activando…', 'info');
    try {
      const r = await fetch('/api/onboarding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        settingsMsg(`Proveedor ${provider} en uso. Modelo: ${data.modelDefault || '—'}.`, 'ok');
        $('settings-key').value = '';
        refreshProviders();
      } else {
        settingsMsg(data.error || 'No se pudo guardar.', 'error');
      }
    } catch (e) { settingsMsg('Sin red hacia el server local.', 'error'); }
  }

  // Modelo (lista en el panel)
  function renderSettingsModels() {
    const wrap = $('settings-models');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const m of models) {
      const isActive = m.id === activeModel || (m.id === 'auto' && (activeModel === 'auto' || activeModel === 'default'));
      const row = document.createElement('button');
      row.className = 'settings-model' + (isActive ? ' active' : '');
      row.innerHTML = `<span class="sm-name"></span><span class="sm-tier font-code-ui"></span>`;
      row.querySelector('.sm-name').textContent = m.label || m.id;
      row.querySelector('.sm-tier').textContent = m.tier && m.tier !== '—' ? m.tier : '';
      row.addEventListener('click', () => setModel(m.id));
      wrap.appendChild(row);
    }
  }

  // Candado / modo / estado
  async function refreshStatusInto() {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) return;
      const s = await r.json();
      const ap = document.querySelector(`#settings-approval input[value="${s.approval}"]`);
      if (ap) ap.checked = true;
      const md = document.querySelector(`#settings-mode input[value="${s.mode}"]`);
      if (md) md.checked = true;
      const th = document.querySelector(`#settings-theme input[value="${window.ShinobiTheme?.getTheme?.() || 'yoru'}"]`);
      if (th) th.checked = true;
      const dl = $('settings-state');
      if (dl) {
        dl.innerHTML = `
          <div><dt>modelo</dt><dd>${shortModel(s.model)}</dd></div>
          <div><dt>candado</dt><dd>${s.approval}</dd></div>`;
      }
    } catch { /* silencio */ }
  }

  async function setApproval(mode) {
    try {
      await fetch('/api/approval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      window.ShinobiToast?.('Candado', `Modo: ${mode}.`);
      refreshStatusInto();
    } catch { /* silencio */ }
  }
  // ─── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Selector de modelo del header
    loadModels();
    $('model-picker-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('model-picker-menu');
      if (menu && menu.hidden) openModelMenu(); else closeModelMenu();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#model-picker')) closeModelMenu();
    });

    // Abrir/cerrar settings
    $('open-settings')?.addEventListener('click', () => openSettings());
    $('settings-close')?.addEventListener('click', closeSettings);
    $('settings-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings(); }
      if (e.key === 'Escape' && !$('settings-modal')?.hidden) closeSettings();
    });

    // Nav de tabs
    document.querySelectorAll('.settings-nav-item').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // Proveedor
    $('settings-test-key')?.addEventListener('click', testKey);
    $('settings-save-key')?.addEventListener('click', saveKey);

    // Candado / modo / tema (radios)
    document.querySelectorAll('#settings-approval input').forEach((r) =>
      r.addEventListener('change', () => r.checked && setApproval(r.value)));
    document.querySelectorAll('#settings-theme input').forEach((r) =>
      r.addEventListener('change', () => r.checked && window.ShinobiTheme?.setTheme?.(r.value)));
  });

  window.ShinobiSettings = { open: openSettings, reloadModels: loadModels };
})();
