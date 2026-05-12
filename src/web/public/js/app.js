// app.js — Bloque 8.2
// Orquestador del front: WS, chat feed, sidebar collapse, ask modal,
// toasts de skill/document. Sustituye el inline <script> del index
// del Bloque 1 sin perder ninguna funcionalidad WS.
//
// Convenciones:
//   - conversationId === activeId del ShinobiConvs. Se envía al server
//     en cada `send`. El server lo trata como sessionId también (back-compat).

(function () {
  'use strict';

  // ─── Estado ───────────────────────────────────────────────────────────
  let ws = null;
  let pendingAgent = null; // referencia al <div class="msg agent pending"> activo
  let askRequestId = null;

  // ─── DOM refs ─────────────────────────────────────────────────────────
  const $chat = document.getElementById('chat');
  const $chatFeed = document.getElementById('chat-feed');
  const $title = document.getElementById('conv-title');
  const $statusChip = document.getElementById('status-chip');
  const $composer = document.getElementById('composer');
  const $sendBtn = document.getElementById('send-btn');
  const $dojo = document.getElementById('dojo');
  const $sidebarCollapse = document.getElementById('sidebar-collapse');
  const $sidebarExpand = document.getElementById('sidebar-expand');
  const $rightToggle = document.getElementById('right-toggle');
  const $rightClose = document.getElementById('right-close');
  const $askModal = document.getElementById('ask-modal');
  const $askQuestion = document.getElementById('ask-question');
  const $askInput = document.getElementById('ask-input');
  const $askOk = document.getElementById('ask-ok');
  const $askCancel = document.getElementById('ask-cancel');
  const $toastStack = document.getElementById('toast-stack');
  const $themeToggle = document.getElementById('theme-toggle');

  // ─── WebSocket ────────────────────────────────────────────────────────
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function connectWS() {
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      setStatus('listo');
    });
    ws.addEventListener('close', () => {
      setStatus('reconectando…');
      setTimeout(connectWS, 1500);
    });
    ws.addEventListener('error', () => { /* close handler hará el retry */ });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleWS(msg);
    });
  }

  function handleWS(msg) {
    switch (msg.type) {
      case 'thinking_start':
        ensurePendingAgent();
        break;
      case 'thinking':
        appendThinkingLine(String(msg.line ?? ''));
        break;
      case 'tool_call':
        appendToolPill(String(msg.name ?? ''));
        break;
      case 'final':
        finalizeAgent(msg);
        break;
      case 'error':
        appendErrorOnPending(String(msg.message ?? 'error desconocido'));
        break;
      case 'ask':
        showAskModal(String(msg.question ?? ''), String(msg.requestId ?? ''));
        break;
      case 'conversation_title_updated':
        if (msg.conversationId && msg.title) {
          window.ShinobiConvs.applyAutoTitle(msg.conversationId, msg.title);
          // Si es la activa, sincronizar el título del header
          const active = window.ShinobiConvs.getActive();
          if (active && active.id === msg.conversationId) $title.textContent = msg.title;
        }
        break;
      case 'skill_event':
        showSkillToast(msg.event || {});
        break;
      case 'document_event':
        showDocumentToast(msg.event || {});
        break;
    }
  }

  function setStatus(label) {
    if ($statusChip) $statusChip.textContent = label;
  }

  // ─── Chat rendering ───────────────────────────────────────────────────
  function chatHasContent() {
    if (!$chatFeed) return false;
    return $chatFeed.childElementCount > 0;
  }
  function syncHasContent() {
    if (!$chat) return;
    if (chatHasContent()) $chat.classList.add('has-content');
    else $chat.classList.remove('has-content');
  }
  function scrollToBottom() {
    if ($chat) $chat.scrollTop = $chat.scrollHeight;
  }

  function makeMsgEl(role, opts = {}) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    if (opts.noAnim) el.classList.add('no-anim');
    const label = document.createElement('span');
    label.className = 'role-label';
    label.textContent = role === 'user' ? 'tú' : role === 'agent' ? 'Shinobi' : 'sistema';
    el.appendChild(label);
    const body = document.createElement('div');
    body.className = 'body';
    el.appendChild(body);
    return el;
  }

  function appendUser(text) {
    const el = makeMsgEl('user', { noAnim: true });
    el.querySelector('.body').textContent = text;
    $chatFeed.appendChild(el);
    syncHasContent();
    scrollToBottom();
  }

  function ensurePendingAgent() {
    if (pendingAgent) return pendingAgent;
    const el = makeMsgEl('agent');
    el.classList.add('pending');
    pendingAgent = el;
    $chatFeed.appendChild(el);
    syncHasContent();
    scrollToBottom();
    return el;
  }

  function ensureThinkingBody(msgEl) {
    let toggle = msgEl.querySelector('.thinking-toggle');
    let body = msgEl.querySelector('.thinking-body');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'thinking-toggle';
      toggle.type = 'button';
      toggle.innerHTML = '<span class="caret">▾</span> Razonamiento';
      msgEl.appendChild(toggle);
      body = document.createElement('div');
      body.className = 'thinking-body';
      msgEl.appendChild(body);
      toggle.addEventListener('click', () => {
        body.classList.toggle('hidden');
      });
    }
    return body;
  }

  function appendThinkingLine(line) {
    const target = ensurePendingAgent();
    const body = ensureThinkingBody(target);
    if (body.textContent) body.textContent += '\n' + line;
    else body.textContent = line;
    scrollToBottom();
  }

  function appendToolPill(name) {
    const target = ensurePendingAgent();
    let pillRow = target.querySelector('.tool-pill-row');
    if (!pillRow) {
      pillRow = document.createElement('div');
      pillRow.className = 'tool-pill-row';
      // Insertar antes del thinking-toggle si existe, o al final
      const tt = target.querySelector('.thinking-toggle');
      if (tt) target.insertBefore(pillRow, tt);
      else target.appendChild(pillRow);
    }
    const pill = document.createElement('span');
    pill.className = 'tool-pill';
    pill.textContent = name;
    pillRow.appendChild(pill);
    scrollToBottom();
  }

  function finalizeAgent(msg) {
    const target = ensurePendingAgent();
    target.classList.remove('pending');
    const body = target.querySelector('.body');
    const text = String(msg.response ?? '');
    body.innerHTML = window.ShinobiMarkdown.render(text);

    // Typewriter — inscribe el texto carácter a carácter sobre el papel.
    // El filete del agente se sincroniza con la duración (capped 1.5s).
    const totalMs = (window.Typewriter && window.Typewriter.reveal(body)) || 0;
    const fileteMs = Math.max(300, Math.min(totalMs, 1500));
    target.style.setProperty('--filete-duration', `${fileteMs}ms`);

    // Cursor parpadeante al final del texto mientras escribe; se remueve al terminar.
    if (totalMs > 250) {
      const cursor = document.createElement('span');
      cursor.className = 'typing-cursor';
      body.appendChild(cursor);
      setTimeout(() => cursor.remove(), totalMs);
    }

    // Hanko 忍 — sello al final, animado con bounce.
    appendHanko(target, { animated: true, delayMs: totalMs + 80 });

    if (msg.mode && msg.model) setStatus(`${msg.mode} · ${msg.model}`);
    else if (msg.model) setStatus(msg.model);
    pendingAgent = null;
    syncHasContent();
    scrollToBottom();
  }

  // Sello 忍 al final de cada mensaje del agente. Animado en live, estático en history.
  function appendHanko(msgEl, opts) {
    opts = opts || {};
    if (msgEl.querySelector('.hanko-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'hanko-wrap';
    wrap.innerHTML = `<svg class="hanko ${opts.animated ? 'animated' : 'static'}" viewBox="0 0 32 32" aria-hidden="true">`
      + `<rect x="2" y="2" width="28" height="28" fill="var(--accent)" stroke="var(--accent)" stroke-width="1"/>`
      + `<text x="16" y="22" font-family="serif" font-size="19" font-weight="700" fill="var(--bg)" text-anchor="middle">忍</text>`
      + `</svg>`;
    if (opts.animated) {
      wrap.querySelector('.hanko').style.setProperty('--hanko-delay', `${opts.delayMs || 0}ms`);
    }
    msgEl.appendChild(wrap);
  }

  function appendErrorOnPending(text) {
    const target = pendingAgent;
    if (target) {
      target.classList.remove('pending');
      target.classList.remove('agent');
      target.classList.add('system');
      const label = target.querySelector('.role-label');
      if (label) label.textContent = 'sistema';
      const body = target.querySelector('.body');
      body.textContent = `error: ${text}`;
      pendingAgent = null;
    } else {
      const el = makeMsgEl('system', { noAnim: true });
      el.querySelector('.body').textContent = `error: ${text}`;
      $chatFeed.appendChild(el);
    }
    syncHasContent();
    scrollToBottom();
  }

  // ─── Historial al cambiar de conversación ─────────────────────────────
  async function loadHistory(conversationId) {
    $chatFeed.innerHTML = '';
    pendingAgent = null;
    if (!conversationId) { syncHasContent(); return; }
    try {
      const r = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
      const data = await r.json();
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) {
        const role = m.role === 'agent' ? 'agent' : (m.role === 'user' ? 'user' : 'system');
        const el = makeMsgEl(role, { noAnim: true }); // no animar el filete en historial cargado
        const body = el.querySelector('.body');
        if (role === 'agent') {
          body.innerHTML = window.ShinobiMarkdown.render(String(m.content || ''));
          appendHanko(el, { animated: false });
          if (Array.isArray(m.thinking) && m.thinking.length > 0) {
            const thinkBody = ensureThinkingBody(el);
            thinkBody.textContent = m.thinking.join('\n');
            thinkBody.classList.add('hidden');
          }
        } else {
          body.textContent = String(m.content || '');
        }
        $chatFeed.appendChild(el);
      }
    } catch (e) {
      console.error('[chat] loadHistory failed', e);
    }
    syncHasContent();
    scrollToBottom();
  }

  // ─── Composer ─────────────────────────────────────────────────────────
  function autoResizeComposer() {
    if (!$composer) return;
    $composer.style.height = 'auto';
    $composer.style.height = Math.min($composer.scrollHeight, 200) + 'px';
    if ($sendBtn) $sendBtn.disabled = $composer.value.trim().length === 0;
  }

  function sendCurrent() {
    if (!$composer) return;
    const text = $composer.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Antes fallaba en silencio. Ahora damos feedback visible y
      // dejamos que el usuario sepa por qué no se envió.
      pushToast('Conexión perdida', 'Reintentando… intenta enviar de nuevo en un instante.', { ttl: 3000 });
      return;
    }
    const active = window.ShinobiConvs.getActive();
    let conversationId = active?.id;
    if (!conversationId) {
      // crea al vuelo si la sidebar está vacía
      window.ShinobiConvs.create({ title: 'Conversación nueva' }).then(c => {
        if (c) doSend(text, c.id);
      });
      return;
    }
    doSend(text, conversationId);
  }

  function doSend(text, conversationId) {
    appendUser(text);
    ws.send(JSON.stringify({ type: 'send', text, conversationId, sessionId: conversationId }));
    $composer.value = '';
    autoResizeComposer();
  }

  // ─── Sidebar collapse + right panel ───────────────────────────────────
  function setSidebarCollapsed(c) {
    $dojo?.setAttribute('data-sidebar', c ? 'collapsed' : 'open');
  }
  function setRightOpen(o) {
    $dojo?.setAttribute('data-right', o ? 'open' : 'closed');
  }

  // ─── Ask modal (Bloque 1 preserved) ───────────────────────────────────
  function showAskModal(question, requestId) {
    askRequestId = requestId;
    $askQuestion.textContent = question;
    $askInput.value = '';
    $askModal.hidden = false;
    setTimeout(() => $askInput.focus(), 50);
  }
  function closeAskModal(send) {
    if (!askRequestId) { $askModal.hidden = true; return; }
    if (send) {
      ws?.send(JSON.stringify({ type: 'ask_response', text: $askInput.value, requestId: askRequestId }));
    } else {
      ws?.send(JSON.stringify({ type: 'ask_response', text: '', requestId: askRequestId }));
    }
    askRequestId = null;
    $askModal.hidden = true;
  }

  // ─── Toasts (Bloque 3/5 preserved) ────────────────────────────────────
  function pushToast(title, body, opts = {}) {
    if (!$toastStack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-title"></div><div class="toast-body"></div>`;
    el.querySelector('.toast-title').textContent = title;
    el.querySelector('.toast-body').textContent = body;
    $toastStack.appendChild(el);
    const ttl = opts.ttl ?? 4500;
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, ttl);
  }
  function showSkillToast(event) {
    const ev = event || {};
    const phase = ev.type || ev.phase || 'evento';
    const name = ev.skill || ev.name || '';
    pushToast(`Skill · ${phase}`, name ? `${name}` : 'evento sin nombre');
  }
  function showDocumentToast(event) {
    const ev = event || {};
    const t = ev.type || 'document_event';
    const msg = ev.message || ev.text || ev.summary || JSON.stringify(ev).slice(0, 140);
    pushToast(`Documento · ${t}`, msg);
  }

  // ─── Title editable ───────────────────────────────────────────────────
  function setupTitleEditing() {
    if (!$title) return;
    $title.addEventListener('dblclick', () => {
      $title.setAttribute('contenteditable', 'true');
      $title.focus();
      // seleccionar todo
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents($title);
      sel.removeAllRanges();
      sel.addRange(r);
    });
    $title.addEventListener('blur', commitTitle);
    $title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $title.blur(); }
      if (e.key === 'Escape') {
        const active = window.ShinobiConvs.getActive();
        if (active) $title.textContent = active.title;
        $title.blur();
      }
    });
  }
  async function commitTitle() {
    $title.setAttribute('contenteditable', 'false');
    const active = window.ShinobiConvs.getActive();
    if (!active) return;
    const newTitle = ($title.textContent || '').trim().slice(0, 60) || active.title;
    if (newTitle !== active.title) {
      await window.ShinobiConvs.rename(active.id, newTitle);
    }
    $title.textContent = newTitle;
  }

  // ─── Empty state: la frase se escribe sola (1 vez por sesión) ────────
  function maybeTypeOpeningPhrase() {
    const phraseEl = document.querySelector('.opening-phrase');
    if (!phraseEl) return;
    if (sessionStorage.getItem('shinobi.phraseTyped') === '1') return;
    sessionStorage.setItem('shinobi.phraseTyped', '1');
    const cursor = phraseEl.querySelector('.cursor-blink');
    if (cursor) cursor.style.opacity = '0';
    const total = (window.Typewriter && window.Typewriter.reveal(phraseEl, { charDuration: 50, maxTotal: 3000 })) || 0;
    setTimeout(() => { if (cursor) cursor.style.opacity = ''; }, total + 80);
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // Composer wiring
    if ($composer) {
      $composer.addEventListener('input', autoResizeComposer);
      $composer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendCurrent();
        }
      });
    }
    $sendBtn?.addEventListener('click', sendCurrent);

    // Sidebar collapse
    $sidebarCollapse?.addEventListener('click', () => setSidebarCollapsed(true));
    $sidebarExpand?.addEventListener('click', () => setSidebarCollapsed(false));

    // Right panel
    $rightToggle?.addEventListener('click', () => {
      const open = $dojo?.getAttribute('data-right') === 'open';
      setRightOpen(!open);
    });
    $rightClose?.addEventListener('click', () => setRightOpen(false));

    // Theme toggle (Hiru ↔ Yoru)
    $themeToggle?.addEventListener('click', () => {
      window.ShinobiTheme?.toggle?.();
    });

    // Modo concentración (Ctrl/Cmd+.)
    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === '.') {
        ev.preventDefault();
        const on = $dojo?.getAttribute('data-focus') === 'on';
        $dojo?.setAttribute('data-focus', on ? 'off' : 'on');
      }
    });

    // Ask modal
    $askOk?.addEventListener('click', () => closeAskModal(true));
    $askCancel?.addEventListener('click', () => closeAskModal(false));
    $askInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); closeAskModal(true); }
      if (e.key === 'Escape') closeAskModal(false);
    });

    setupTitleEditing();
    maybeTypeOpeningPhrase();

    // Conversaciones: init y subscribe al cambio de activa
    window.ShinobiConvs.onSelect(async (id) => {
      const c = window.ShinobiConvs.getActive();
      if ($title) $title.textContent = c?.title || '';
      await loadHistory(id);
    });
    window.ShinobiConvs.onChange(() => {
      // re-sincroniza título si la conv activa cambió por auto-title
      const c = window.ShinobiConvs.getActive();
      if (c && $title) $title.textContent = c.title;
    });

    // BUG 2 fix — abrir el WS PRIMERO, antes de bloquear en init().
    // Si init() tarda (red lenta, fetch fallido), el send sigue
    // operacional en cuanto el WS abre, y el usuario no encuentra un
    // botón que falla en silencio.
    connectWS();
    await window.ShinobiConvs.init();
  });
})();
