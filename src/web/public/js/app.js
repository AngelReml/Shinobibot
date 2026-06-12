// app.js — Bloque 8.5 + UX no-técnico (M2/M4/M5/M6/M7 · A1/A2/A3/A4)
// Orquestador del front: WS, feed del chat, Rastro vivo, candado, clima,
// paleta de comandos, habilidades (⟡), tour de primera vez.
// Habla TODO el protocolo que el server emite:
//   thinking_start · thinking · tool_call · tool_event · plan ·
//   skill_activated · final · error · ask · approval_request ·
//   conversation_title_updated · skill_event · document_event · browser_frame
//
// Convenciones:
//   - conversationId === activeId de ShinobiConvs. Se envía en cada `send`.
//   - El clima (§2.2) emerge del estado real: calma / lluvia / tormenta /
//     niebla / noche. Se publica en <body data-clima> y en el Rastro.

(function () {
  'use strict';

  // ─── Estado ───────────────────────────────────────────────────────────
  let ws = null;
  let wsRetryMs = 1500;            // backoff: 1.5s → ×1.5 → máx 15s
  let pendingAgent = null;         // <div class="msg agent pending"> activo
  let askRequestId = null;
  let approvalRequestId = null;
  let activeTools = 0;             // herramientas en vuelo (tormenta si ≥2)
  let lastStatus = { mode: null, model: null, approval: null };
  let kageSeen = false;

  // ─── DOM refs ─────────────────────────────────────────────────────────
  const $chat = document.getElementById('chat');
  const $chatFeed = document.getElementById('chat-feed');
  const $title = document.getElementById('conv-title');
  const $statusChip = document.getElementById('status-chip');
  const $tokenChip = document.getElementById('token-chip');
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
  const $approvalModal = document.getElementById('approval-modal');
  const $approvalQuestion = document.getElementById('approval-question');
  const $approvalKind = document.getElementById('approval-kind');
  const $approvalIntent = document.getElementById('approval-intent');
  const $approvalRastroLabel = document.getElementById('approval-rastro-label');
  const $approvalYes = document.getElementById('approval-yes');
  const $approvalNo = document.getElementById('approval-no');
  const $approvalAlways = document.getElementById('approval-always');
  const $toastStack = document.getElementById('toast-stack');
  const $themeToggle = document.getElementById('theme-toggle');
  // Rastro
  const $rkClima = document.getElementById('rk-clima');
  const $rkModo = document.getElementById('rk-modo');
  const $rkModelo = document.getElementById('rk-modelo');
  const $rkCandado = document.getElementById('rk-candado');
  const $rkTokens = document.getElementById('rk-tokens');
  const $rastroPlanSec = document.getElementById('rastro-plan-sec');
  const $rastroPlan = document.getElementById('rastro-plan');
  const $rastroTools = document.getElementById('rastro-tools');
  const $rastroToolsEmpty = document.getElementById('rastro-tools-empty');
  const $rastroKageSec = document.getElementById('rastro-kage-sec');
  const $kageFrame = document.getElementById('kage-frame');
  // Paleta de comandos
  const $cmdPalette = document.getElementById('cmd-palette');
  // A1 — habilidades
  const $skillsChipRow = document.getElementById('skills-chip-row');
  const $skillsTriggerBtn = document.getElementById('skills-trigger-btn');

  // ─── Clima (§2.2) — emerge del estado real, nunca se finge ───────────
  function computeClima() {
    if ($approvalModal && !$approvalModal.hidden) return 'niebla';
    if (!ws || ws.readyState !== WebSocket.OPEN) return 'noche';
    if (activeTools >= 2) return 'tormenta';
    if (pendingAgent) return 'lluvia';
    return 'calma';
  }
  const CLIMA_LABEL = {
    calma: 'calma', lluvia: 'lluvia fina', tormenta: 'tormenta contenida',
    niebla: 'niebla', noche: 'noche cerrada',
  };
  function syncClima() {
    const c = computeClima();
    document.body.setAttribute('data-clima', c);
    if ($rkClima) $rkClima.textContent = CLIMA_LABEL[c];
    renderStatusChip(c);
    syncBusy();
  }
  function renderStatusChip(clima) {
    if (!$statusChip) return;
    const parts = [];
    if (clima && clima !== 'calma') parts.push(CLIMA_LABEL[clima]);
    if (lastStatus.mode) parts.push(lastStatus.mode);
    if (lastStatus.model) parts.push(lastStatus.model);
    $statusChip.textContent = parts.join(' · ') || 'listo';
  }

  // M5 — ocupado honesto: composer y botón reflejan que Shinobi trabaja.
  let savedPlaceholder = null;
  function syncBusy() {
    const busy = !!pendingAgent;
    if ($composer) {
      $composer.setAttribute('data-busy', busy ? 'true' : 'false');
      if (busy && savedPlaceholder === null) {
        savedPlaceholder = $composer.placeholder;
        $composer.placeholder = 'Shinobi está trabajando en esta misión…';
      } else if (!busy && savedPlaceholder !== null) {
        $composer.placeholder = savedPlaceholder;
        savedPlaceholder = null;
      }
    }
    if ($sendBtn) $sendBtn.disabled = busy || !($composer && $composer.value.trim().length > 0);
  }

  // ─── Constantes del Rastro (/api/status + /api/token-budget) ─────────
  async function refreshStatus() {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) return;
      const s = await r.json();
      lastStatus.mode = s.mode || null;
      lastStatus.model = s.model || null;
      lastStatus.approval = s.approval || null;
      if ($rkModo) $rkModo.textContent = s.mode || '—';
      if ($rkModelo) $rkModelo.textContent = s.model || '—';
      if ($rkCandado) $rkCandado.textContent = s.approval || '—';
      syncClima();
    } catch { /* el Rastro no inventa: deja el guion */ }
  }

  function fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }
  async function refreshTokenBudget() {
    try {
      const active = window.ShinobiConvs.getActive();
      const sid = active ? active.id : 'default';
      const r = await fetch(`/api/token-budget?sessionId=${encodeURIComponent(sid)}`);
      if (!r.ok) return;
      const t = await r.json();
      const used = Number(t.usedTokens) || 0;
      const budget = Number(t.budgetTokens) || 0;
      const label = `${fmtTokens(used)} / ${fmtTokens(budget)}`;
      if ($tokenChip) {
        $tokenChip.textContent = label;
        $tokenChip.hidden = !(used > 0 && budget > 0);
      }
      if ($rkTokens) $rkTokens.textContent = budget ? `${label} tokens` : '—';
    } catch { /* silencio */ }
  }

  // ─── WebSocket ────────────────────────────────────────────────────────
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function connectWS() {
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      wsRetryMs = 1500;
      syncClima();
      refreshStatus();
      refreshTokenBudget();
    });
    ws.addEventListener('close', () => {
      syncClima();
      setTimeout(connectWS, wsRetryMs);
      wsRetryMs = Math.min(Math.round(wsRetryMs * 1.5), 15000);
    });
    ws.addEventListener('error', () => { /* close hará el retry */ });
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
        syncClima();
        break;
      case 'thinking':
        appendThinkingLine(String(msg.line ?? ''));
        break;
      case 'plan':
        appendPlanLine(String(msg.text ?? ''));
        break;
      case 'skill_activated':
        appendToolPill(String(msg.text ?? 'skill'), { kind: 'skill' });
        break;
      case 'tool_call':
        appendToolPill(String(msg.name ?? ''));
        break;
      case 'tool_event':
        handleToolEvent(msg.event || {});
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
      case 'approval_request':
        showApprovalModal(String(msg.promptText ?? ''), String(msg.requestId ?? ''), msg.kind, msg.tool);
        break;
      case 'conversation_title_updated':
        if (msg.conversationId && msg.title) {
          window.ShinobiConvs.applyAutoTitle(msg.conversationId, msg.title);
          const active = window.ShinobiConvs.getActive();
          if (active && active.id === msg.conversationId && $title) $title.textContent = msg.title;
        }
        break;
      case 'skill_event':
        showSkillToast(msg.event || {});
        break;
      case 'document_event':
        showDocumentToast(msg.event || {});
        break;
      case 'browser_frame':
        handleBrowserFrame(msg);
        break;
    }
  }

  // ─── A2: diccionario tool → verbo legible (capa humana del Rastro) ────
  const TOOL_LABELS = {
    read_file: 'Leyendo archivo',
    write_file: 'Escribiendo archivo',
    edit_file: 'Editando archivo',
    list_directory: 'Explorando carpeta',
    run_command: 'Ejecutando comando',
    shell: 'Ejecutando comando',
    bash: 'Ejecutando comando',
    browser_navigate: 'Navegando por la web',
    browser_screenshot: 'Mirando la página',
    browser_click: 'Haciendo clic',
    browser_type: 'Escribiendo en el navegador',
    web_search: 'Buscando en la web',
    search: 'Buscando información',
    ask_user: 'Pidiendo confirmación',
    generate_document: 'Creando documento',
    send_notification: 'Enviando notificación',
  };
  function humanizeTool(name) {
    return TOOL_LABELS[name] || name;
  }

  // ─── Rastro: herramientas en vivo (tool_event del orchestrator) ───────
  const MAX_TRAZOS = 30;
  const trazosVivos = new Map(); // tool name → último <div.trazo> en curso

  function handleToolEvent(ev) {
    if (!ev || !ev.kind) return;
    if (ev.kind === 'tool_started') {
      activeTools++;
      addTrazo(ev);
      markPill(ev.tool, null); // la pill existe ya via tool_call; sin cambio
    } else if (ev.kind === 'tool_completed') {
      activeTools = Math.max(0, activeTools - 1);
      settleTrazo(ev);
      markPill(ev.tool, ev.success ? 'seco' : 'cerrado');
    }
    syncClima();
  }

  function addTrazo(ev) {
    if (!$rastroTools) return;
    if ($rastroToolsEmpty) $rastroToolsEmpty.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'trazo';
    const name = document.createElement('span');
    name.className = 'trazo-name';
    name.textContent = ev.tool || '?';
    const meta = document.createElement('span');
    meta.className = 'trazo-meta';
    meta.textContent = ev.argsPreview || '';
    el.appendChild(name);
    el.appendChild(meta);
    $rastroTools.prepend(el);
    trazosVivos.set(ev.tool, el);
    while ($rastroTools.childElementCount > MAX_TRAZOS) {
      $rastroTools.lastElementChild.remove();
    }
  }

  function settleTrazo(ev) {
    const el = trazosVivos.get(ev.tool);
    if (!el) return;
    trazosVivos.delete(ev.tool);
    el.classList.add(ev.success ? 'seco' : 'cerrado');
    const meta = el.querySelector('.trazo-meta');
    if (meta) {
      const dur = typeof ev.durationMs === 'number' ? `${(ev.durationMs / 1000).toFixed(1)}s` : '';
      meta.textContent = ev.success ? dur : (ev.errorPreview || 'falló') + (dur ? ` · ${dur}` : '');
    }
  }

  // ─── Kage: frames del navegador del agente ────────────────────────────
  function handleBrowserFrame(msg) {
    if (!msg || !msg.dataB64 || !$kageFrame) return;
    if (!kageSeen) {
      kageSeen = true;
      if ($rastroKageSec) $rastroKageSec.hidden = false;
      // El navegador despertó: el Rastro se abre solo si estaba cerrado.
      if ($dojo && $dojo.getAttribute('data-right') !== 'open') setRightOpen(true);
    }
    $kageFrame.src = `data:image/jpeg;base64,${msg.dataB64}`;
  }

  // ─── M7: errores en voz baja Y en cristiano ───────────────────────────
  const ERROR_PATTERNS = [
    { re: /rate.?limit|429|too many requests/i, msg: 'El proveedor está saturado. Espera un momento o cambia de modelo en Ajustes → Modelo.' },
    { re: /invalid.*(api.?key|key)|401|unauthorized|key inválida/i, msg: 'La key del proveedor no es válida. Revísala en Ajustes → Proveedor.' },
    { re: /ENOENT|no such file/i, msg: 'No se encontró el archivo o carpeta indicado.' },
    { re: /EACCES|permission denied/i, msg: 'Sin permiso para acceder a ese recurso.' },
    { re: /ETIMEDOUT|timed?\s*out/i, msg: 'La operación tardó demasiado y se canceló. Puedes reintentar.' },
    { re: /ENETUNREACH|ECONNREFUSED|fetch failed|network/i, msg: 'Error de red al conectar. Comprueba tu conexión a internet.' },
    { re: /context|token.*(limit|budget)/i, msg: 'La misión acumuló demasiado contexto. Prueba en una misión nueva.' },
  ];
  function humanizeError(text) {
    for (const p of ERROR_PATTERNS) {
      if (p.re.test(text)) return p.msg;
    }
    return null;
  }
  // Construye el cuerpo del error: línea humana + detalle técnico SIEMPRE
  // disponible plegado (la verdad no se esconde, se ordena).
  function buildErrorBody(text) {
    const human = humanizeError(text);
    const wrapper = document.createElement('div');
    wrapper.className = 'error-human-msg';
    const main = document.createElement('div');
    main.textContent = human || 'Algo se torció en la misión. El detalle técnico está debajo.';
    wrapper.appendChild(main);
    const toggle = document.createElement('button');
    toggle.className = 'error-detail-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Ver detalle técnico';
    const raw = document.createElement('pre');
    raw.className = 'error-detail-raw hidden';
    raw.textContent = text;
    toggle.addEventListener('click', () => {
      raw.classList.toggle('hidden');
      toggle.textContent = raw.classList.contains('hidden') ? 'Ver detalle técnico' : 'Ocultar detalle';
    });
    wrapper.appendChild(toggle);
    wrapper.appendChild(raw);
    return wrapper;
  }

  // ─── M2/M4: acciones por mensaje (copiar · retomar) ───────────────────
  function addMsgActions(el, role) {
    const row = document.createElement('div');
    row.className = 'msg-actions';
    const btnCopy = document.createElement('button');
    btnCopy.className = 'msg-action-btn';
    btnCopy.type = 'button';
    btnCopy.title = 'Copiar mensaje';
    btnCopy.textContent = '⧉';
    btnCopy.addEventListener('click', () => {
      const body = el.querySelector('.body');
      const txt = body ? (body.innerText || body.textContent || '') : '';
      navigator.clipboard.writeText(txt).then(() => {
        btnCopy.textContent = '✓';
        setTimeout(() => { btnCopy.textContent = '⧉'; }, 1500);
      }).catch(() => {});
    });
    row.appendChild(btnCopy);
    if (role === 'user') {
      const btnRetomar = document.createElement('button');
      btnRetomar.className = 'msg-action-btn';
      btnRetomar.type = 'button';
      btnRetomar.title = 'Retomar — copia este mensaje al compositor para corregirlo y reenviar';
      btnRetomar.textContent = '↺';
      btnRetomar.addEventListener('click', () => {
        if (!$composer) return;
        const body = el.querySelector('.body');
        $composer.value = body ? (body.innerText || body.textContent || '') : '';
        $composer.focus();
        autoResizeComposer();
        renderSkillSuggestions();
      });
      row.appendChild(btnRetomar);
    }
    el.appendChild(row);
  }

  // ─── Chat rendering ───────────────────────────────────────────────────
  function chatHasContent() {
    return !!$chatFeed && $chatFeed.childElementCount > 0;
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
    label.textContent = role === 'user' ? 'operador' : role === 'agent' ? 'Shinobi' : 'sistema';
    el.appendChild(label);
    const body = document.createElement('div');
    body.className = 'body';
    el.appendChild(body);
    if (role !== 'system') addMsgActions(el, role);
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
    syncClima();
    return el;
  }

  function ensureThinkingBody(msgEl) {
    let toggle = msgEl.querySelector('.thinking-toggle');
    let body = msgEl.querySelector('.thinking-body');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'thinking-toggle';
      toggle.type = 'button';
      toggle.innerHTML = '<span class="caret">▾</span> Rastro';
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

  // Plan del modelo ([🧠]) — la intención, visible también en el Rastro.
  function appendPlanLine(text) {
    if (!text) return;
    const target = ensurePendingAgent();
    let plan = target.querySelector('.plan-line');
    if (!plan) {
      plan = document.createElement('span');
      plan.className = 'plan-line';
      const tt = target.querySelector('.thinking-toggle');
      if (tt) target.insertBefore(plan, tt);
      else target.appendChild(plan);
    }
    plan.textContent = text;
    if ($rastroPlanSec && $rastroPlan) {
      $rastroPlanSec.hidden = false;
      $rastroPlan.textContent = text;
    }
    scrollToBottom();
  }

  function appendToolPill(name, opts = {}) {
    if (!name) return;
    const target = ensurePendingAgent();
    let pillRow = target.querySelector('.tool-pill-row');
    if (!pillRow) {
      pillRow = document.createElement('div');
      pillRow.className = 'tool-pill-row';
      const tt = target.querySelector('.thinking-toggle');
      if (tt) target.insertBefore(pillRow, tt);
      else target.appendChild(pillRow);
    }
    const pill = document.createElement('span');
    pill.className = 'tool-pill';
    pill.dataset.tool = name;
    // A2 — capa humana: verbo legible; el nombre técnico queda en el tooltip.
    const human = humanizeTool(name);
    const label = human.length > 48 ? human.slice(0, 45) + '…' : human;
    pill.textContent = opts.kind === 'skill' ? `⟡ ${label}` : label;
    if (human !== name) pill.title = name;
    pillRow.appendChild(pill);
    scrollToBottom();
  }

  // La pill del mensaje se seca/cierra cuando tool_event reporta el fin.
  function markPill(toolName, state) {
    if (!state || !pendingAgent) return;
    const pills = pendingAgent.querySelectorAll(`.tool-pill[data-tool="${CSS.escape(toolName)}"]`);
    const last = pills[pills.length - 1];
    if (last) last.classList.add(state);
  }

  function finalizeAgent(msg) {
    // Guard de conversación: si el final pertenece a otra conversación
    // (el operador cambió mientras Shinobi trabajaba), no contaminamos el
    // papel activo. El historial del server ya lo guardó; dejamos huella.
    const active = window.ShinobiConvs.getActive();
    if (msg.conversationId && active && active.id !== msg.conversationId) {
      if (pendingAgent) { pendingAgent.remove(); pendingAgent = null; }
      if (msg.mode) lastStatus.mode = String(msg.mode);
      if (msg.model) lastStatus.model = String(msg.model);
      window.ShinobiConvs.setHuella?.(msg.conversationId);
      registerMissionCompleted();
      syncHasContent();
      syncClima();
      refreshTokenBudget();
      return;
    }

    const target = ensurePendingAgent();
    target.classList.remove('pending');
    const body = target.querySelector('.body');
    const text = String(msg.response ?? '');
    body.innerHTML = window.ShinobiMarkdown.render(text);

    // El pincel avanza: typewriter lineal (sin fade por carácter, Tabla 13).
    const totalMs = (window.Typewriter && window.Typewriter.reveal(body)) || 0;
    if (totalMs > 250) {
      const cursor = document.createElement('span');
      cursor.className = 'typing-cursor';
      body.appendChild(cursor);
      setTimeout(() => cursor.remove(), totalMs);
    }

    // Hanko 忍 — el sello se asienta al terminar la inscripción.
    appendHanko(target, { animated: true, delayMs: totalMs + 80 });

    if (msg.mode) lastStatus.mode = String(msg.mode);
    if (msg.model) lastStatus.model = String(msg.model);

    // Huella: misión con trabajo terminado (Tabla 7).
    if (msg.conversationId) window.ShinobiConvs.setHuella?.(msg.conversationId);
    registerMissionCompleted();

    pendingAgent = null;
    syncHasContent();
    scrollToBottom();
    syncClima();
    refreshTokenBudget();
  }

  // El dojo lleva la cuenta del camino del operador (§10.1).
  function registerMissionCompleted() {
    try {
      const n = (parseInt(localStorage.getItem('shinobi.misiones') || '0', 10) || 0) + 1;
      localStorage.setItem('shinobi.misiones', String(n));
    } catch { /* sin memoria, sin camino */ }
  }

  // Sello al final de cada salida del agente. 忍; 師 en modo sensei.
  function appendHanko(msgEl, opts) {
    opts = opts || {};
    if (msgEl.querySelector('.hanko-wrap')) return;
    const kanji = window.ShinobiEggs && window.ShinobiEggs.currentHankoKanji
      ? window.ShinobiEggs.currentHankoKanji()
      : '忍';
    const wrap = document.createElement('div');
    wrap.className = 'hanko-wrap';
    wrap.innerHTML = `<svg class="hanko ${opts.animated ? 'animated' : 'static'}" viewBox="0 0 32 32" aria-hidden="true">`
      + `<rect x="2" y="2" width="28" height="28" fill="var(--accent)" stroke="var(--accent)" stroke-width="1"/>`
      + `<text x="16" y="22" font-family="serif" font-size="19" font-weight="700" fill="var(--bg)" text-anchor="middle">${kanji}</text>`
      + `</svg>`;
    if (opts.animated) {
      wrap.querySelector('.hanko').style.setProperty('--hanko-delay', `${opts.delayMs || 0}ms`);
    }
    msgEl.appendChild(wrap);
  }

  // El error en voz baja (§6): tinta oscura, causa humana, detalle plegado.
  function appendErrorOnPending(text) {
    const errorBody = buildErrorBody(text);
    const target = pendingAgent;
    if (target) {
      target.classList.remove('pending');
      target.classList.remove('agent');
      target.classList.add('system', 'cerrado');
      const label = target.querySelector('.role-label');
      if (label) label.textContent = 'sistema';
      const body = target.querySelector('.body');
      body.innerHTML = '';
      body.appendChild(errorBody);
      pendingAgent = null;
    } else {
      const el = makeMsgEl('system', { noAnim: true });
      el.classList.add('cerrado');
      el.querySelector('.body').appendChild(errorBody);
      $chatFeed.appendChild(el);
    }
    syncHasContent();
    scrollToBottom();
    syncClima();
  }

  // ─── Historial al cambiar de conversación ─────────────────────────────
  async function loadHistory(conversationId) {
    $chatFeed.innerHTML = '';
    pendingAgent = null;
    syncBusy();
    if (!conversationId) { syncHasContent(); return; }
    try {
      const r = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
      const data = await r.json();
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) {
        const role = m.role === 'agent' ? 'agent' : (m.role === 'user' ? 'user' : 'system');
        const el = makeMsgEl(role, { noAnim: true });
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
    refreshTokenBudget();
  }

  // ─── Composer ─────────────────────────────────────────────────────────
  function autoResizeComposer() {
    if (!$composer) return;
    $composer.style.height = 'auto';
    $composer.style.height = Math.min($composer.scrollHeight, 200) + 'px';
    if ($sendBtn) $sendBtn.disabled = !!pendingAgent || $composer.value.trim().length === 0;
  }

  function sendCurrent() {
    if (!$composer) return;
    // M5 — Shinobi trabaja en serie: no se envía mientras hay misión en curso.
    if (pendingAgent) {
      pushToast('Shinobi está trabajando', 'Espera a que termine la misión actual.', { ttl: 2500 });
      return;
    }
    const text = $composer.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushToast('Sin conexión', 'Reintentando en silencio. Vuelve a enviar en un instante.', { ttl: 3000 });
      return;
    }
    hideCmdPalette();
    hideSkillSuggestions();
    const active = window.ShinobiConvs.getActive();
    let conversationId = active?.id;
    if (!conversationId) {
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
    $composer.classList.remove('slash-mode', 'haiku-mode');
    autoResizeComposer();
  }

  // ─── Paleta de comandos — las habilidades del dojo, a un "/" ──────────
  // Fuente de verdad: GET /api/commands (registro real del backend).
  // Fallback local si el endpoint aún no existe (back-compat).
  const FALLBACK_COMMANDS = [
    { cmd: '/status', desc: 'Estado del agente: modelo, candado' },
    { cmd: '/model', desc: 'Ver o cambiar el modelo (auto, list, nombre)' },
    { cmd: '/memory', desc: 'Memoria: recall · store · stats · forget · user · env' },
    { cmd: '/skill', desc: 'Skills: list · approve · install · reload' },
    { cmd: '/doc', desc: 'Generar documento: word · pdf · excel · markdown · auto' },
    { cmd: '/learn', desc: 'Aprender de una ruta o URL' },
    { cmd: '/read', desc: 'Leer un repo o carpeta con presupuesto' },
    { cmd: '/replay', desc: 'Resumen de misiones del audit log' },
    { cmd: '/ledger', desc: 'Cadena de misiones: verify · export' },
    { cmd: '/committee', desc: 'Comité de validación sobre un informe' },
    { cmd: '/improvements', desc: 'Propuestas de mejora del comité' },
    { cmd: '/apply', desc: 'Aplicar una propuesta por id' },
    { cmd: '/self', desc: 'Auto-informe del agente (--diff, --budget)' },
    { cmd: '/approval', desc: 'Candado: on · smart · critical · off' },
    { cmd: '/resident', desc: 'Tareas residentes: start · stop · add · logs' },
    { cmd: '/sentinel', desc: 'Vigilancia tecnológica: watch · ask · digest' },
    { cmd: '/notify', desc: 'Notificaciones webhook: set · unset · test' },
    { cmd: '/record', desc: 'Grabar la sesión con OBS: start · stop' },
    { cmd: '/zen', desc: 'Modo zen — Esc para salir' },
  ];
  let COMMANDS = FALLBACK_COMMANDS;
  let cmdSelected = 0;

  async function loadCommands() {
    try {
      const r = await fetch('/api/commands');
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.commands) && data.commands.length > 0) {
          COMMANDS = data.commands
            .map(c => ({ cmd: String(c.cmd || ''), desc: String(c.desc || '') }))
            .filter(c => c.cmd.startsWith('/'));
          // /zen es mecánica del front: asegurar presencia.
          if (!COMMANDS.some(c => c.cmd === '/zen')) {
            COMMANDS.push({ cmd: '/zen', desc: 'Modo zen — Esc para salir' });
          }
        }
      }
    } catch { /* fallback ya en su sitio */ }
    // El pergamino (Ctrl+/) recibe la lista final, venga de donde venga.
    window.ShinobiEggs?.setCommands?.(COMMANDS);
  }

  function filteredCommands() {
    const v = $composer.value.trim().toLowerCase();
    if (!v.startsWith('/')) return [];
    const q = v.split(/\s+/)[0];
    return COMMANDS.filter(c => c.cmd.startsWith(q) || q === '/');
  }

  function renderCmdPalette() {
    if (!$cmdPalette) return;
    const matches = filteredCommands();
    const hasSpace = /\s/.test($composer.value.trimStart());
    if (matches.length === 0 || hasSpace) { hideCmdPalette(); return; }
    cmdSelected = Math.min(cmdSelected, matches.length - 1);
    $cmdPalette.innerHTML = '';
    matches.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'cmd-item' + (i === cmdSelected ? ' selected' : '');
      item.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.className = 'cmd-name';
      name.textContent = c.cmd;
      const desc = document.createElement('span');
      desc.className = 'cmd-desc';
      desc.textContent = c.desc;
      item.appendChild(name);
      item.appendChild(desc);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyCommand(c.cmd);
      });
      $cmdPalette.appendChild(item);
    });
    $cmdPalette.hidden = false;
  }

  function hideCmdPalette() {
    if ($cmdPalette) { $cmdPalette.hidden = true; $cmdPalette.innerHTML = ''; }
    cmdSelected = 0;
  }

  function applyCommand(cmd) {
    $composer.value = cmd + ' ';
    $composer.focus();
    hideCmdPalette();
    syncSlashMode();
    autoResizeComposer();
  }

  function syncSlashMode() {
    if (!$composer) return;
    $composer.classList.toggle('slash-mode', $composer.value.trimStart().startsWith('/'));
  }

  function cmdPaletteKeydown(e) {
    if (!$cmdPalette || $cmdPalette.hidden) return false;
    const matches = filteredCommands();
    if (matches.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdSelected = (cmdSelected + 1) % matches.length;
      renderCmdPalette();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdSelected = (cmdSelected - 1 + matches.length) % matches.length;
      renderCmdPalette();
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      applyCommand(matches[cmdSelected].cmd);
      return true;
    }
    if (e.key === 'Enter' && $composer.value.trim() !== matches[cmdSelected].cmd) {
      // Enter con comando incompleto → completar, no enviar.
      const v = $composer.value.trim();
      if (v.split(/\s+/).length === 1 && v !== matches[cmdSelected].cmd) {
        e.preventDefault();
        applyCommand(matches[cmdSelected].cmd);
        return true;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCmdPalette();
      return true;
    }
    return false;
  }

  // ─── A1: Habilidades — chips vivos + panel ⟡ ─────────────────────────
  // GET /api/skills una vez al boot. Mientras el operador escribe, el
  // matching por trigger_keywords (la MISMA semántica que usa el server
  // en getContextSection) anticipa qué habilidades pueden despertar.
  // El evento [🧩] confirma después la activación real: anticipar → confirmar.
  let allSkills = [];
  let skillsPanelOpen = false;
  let skillSuggestTimer = null;

  function normalizeTxt(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  async function loadSkills() {
    try {
      const r = await fetch('/api/skills');
      if (!r.ok) return;
      const data = await r.json();
      allSkills = (Array.isArray(data.skills) ? data.skills : []).map(sk => ({
        id: String(sk.id || sk.name || ''),
        name: String(sk.name || ''),
        description: String(sk.description || ''),
        keywords: (Array.isArray(sk.trigger_keywords) ? sk.trigger_keywords : []).map(normalizeTxt).filter(Boolean),
        source: sk.source === 'skill' ? 'skill' : 'native',
      })).filter(sk => sk.name);
    } catch { /* sin habilidades visibles; el dojo sigue */ }
  }

  function matchSkills(input) {
    const txt = normalizeTxt(input);
    if (txt.length < 3) return [];
    const out = [];
    for (const sk of allSkills) {
      if (sk.keywords.some(k => k && txt.includes(k))) out.push(sk);
      if (out.length >= 3) break;
    }
    return out;
  }

  function renderChips(list, mode) {
    if (!$skillsChipRow) return;
    $skillsChipRow.innerHTML = '';
    if (!list.length) { $skillsChipRow.hidden = true; return; }
    for (const sk of list) {
      const chip = document.createElement('button');
      chip.className = 'skills-chip' + (sk.source === 'skill' ? ' aprendida' : '');
      chip.type = 'button';
      chip.title = sk.description;
      const glyph = document.createElement('span');
      glyph.className = 'chip-glyph';
      glyph.textContent = '⟡';
      chip.appendChild(glyph);
      chip.appendChild(document.createTextNode(
        mode === 'suggest' ? `${sk.name} — puede activarse` : sk.name
      ));
      chip.addEventListener('click', () => {
        pushToast(`⟡ ${sk.name}`, sk.description || 'Habilidad del dojo.', { ttl: 5000 });
      });
      $skillsChipRow.appendChild(chip);
    }
    $skillsChipRow.hidden = false;
  }

  function hideSkillSuggestions() {
    if (skillsPanelOpen) return; // el panel manda
    if ($skillsChipRow) { $skillsChipRow.hidden = true; $skillsChipRow.innerHTML = ''; }
  }

  // Sugerencias vivas: debounce 250ms sobre el input del composer.
  function renderSkillSuggestions() {
    if (skillsPanelOpen || !$skillsChipRow) return;
    clearTimeout(skillSuggestTimer);
    skillSuggestTimer = setTimeout(() => {
      if (skillsPanelOpen) return;
      const v = $composer ? $composer.value : '';
      if (!v || v.trimStart().startsWith('/')) { hideSkillSuggestions(); return; }
      renderChips(matchSkills(v), 'suggest');
    }, 250);
  }

  function toggleSkillsPanel(force) {
    skillsPanelOpen = force !== undefined ? force : !skillsPanelOpen;
    if ($skillsTriggerBtn) $skillsTriggerBtn.setAttribute('aria-expanded', String(skillsPanelOpen));
    if (skillsPanelOpen) {
      renderChips(allSkills, 'panel');
    } else {
      if ($skillsChipRow) { $skillsChipRow.hidden = true; $skillsChipRow.innerHTML = ''; }
      renderSkillSuggestions();
    }
  }

  // ─── Sidebar collapse + Rastro ────────────────────────────────────────
  function setSidebarCollapsed(c) {
    $dojo?.setAttribute('data-sidebar', c ? 'collapsed' : 'open');
  }
  function setRightOpen(o) {
    $dojo?.setAttribute('data-right', o ? 'open' : 'closed');
  }

  // ─── Ask modal ────────────────────────────────────────────────────────
  function showAskModal(question, requestId) {
    askRequestId = requestId;
    $askQuestion.textContent = question;
    $askInput.value = '';
    $askModal.hidden = false;
    setTimeout(() => $askInput.focus(), 50);
  }
  function closeAskModal(send) {
    if (!askRequestId) { $askModal.hidden = true; return; }
    ws?.send(JSON.stringify({ type: 'ask_response', text: send ? $askInput.value : '', requestId: askRequestId }));
    askRequestId = null;
    $askModal.hidden = true;
  }

  // ─── Candado (§11) — la pausa sin urgencia, ahora legible (A3) ────────
  function showApprovalModal(promptText, requestId, kind, tool) {
    approvalRequestId = requestId;
    $approvalQuestion.textContent = promptText;
    if ($approvalKind) {
      $approvalKind.textContent = kind === 'browser_consent'
        ? 'Kage pide cruzar una puerta sensible del navegador. La misión espera tu palabra.'
        : 'La misión toca territorio sensible. Necesita tu aprobación para continuar.';
    }
    // A3 — línea humana: qué quiere hacer, en cristiano. El detalle técnico
    // completo sigue visible debajo: la verdad no se negocia.
    if ($approvalIntent) {
      if (tool) {
        $approvalIntent.textContent = `Shinobi quiere: ${humanizeTool(String(tool))}`;
        $approvalIntent.hidden = false;
      } else {
        $approvalIntent.hidden = true;
      }
    }
    if ($approvalRastroLabel) $approvalRastroLabel.hidden = false;
    $approvalModal.hidden = false;
    syncClima(); // niebla: el mundo pierde medio tono; el candado queda nítido
  }
  function closeApprovalModal(answer) {
    if (!approvalRequestId) { $approvalModal.hidden = true; syncClima(); return; }
    ws?.send(JSON.stringify({ type: 'approval_response', answer, requestId: approvalRequestId }));
    approvalRequestId = null;
    $approvalModal.hidden = true;
    syncClima();
  }

  // ─── Toasts de sistema (skills / documentos) ──────────────────────────
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
  // Expuesto para settings.js / otros módulos.
  window.ShinobiToast = pushToast;

  function showSkillToast(event) {
    const ev = event || {};
    const phase = ev.type || ev.phase || 'evento';
    const name = ev.skill || ev.name || '';
    pushToast(`Skill · ${phase}`, name || 'evento sin nombre');
  }
  function showDocumentToast(event) {
    const ev = event || {};
    const t = ev.type || 'documento';
    const msg = ev.message || ev.text || ev.summary || JSON.stringify(ev).slice(0, 140);
    pushToast(`Documento · ${t}`, msg);
  }

  // ─── Título editable ──────────────────────────────────────────────────
  function setupTitleEditing() {
    if (!$title) return;
    $title.addEventListener('dblclick', () => {
      $title.setAttribute('contenteditable', 'true');
      $title.focus();
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

  // ─── Estado vacío: la frase se escribe sola (1 vez por sesión) ────────
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

  // ─── A4: Tour de primera vez — traduce las metáforas una sola vez ─────
  const TOUR_KEY = 'shinobi.tourDone.v1';
  const TOUR_STEPS = [
    {
      title: 'Bienvenido al dojo',
      body: 'Shinobi es tu agente: ejecuta acciones reales en tu máquina — organiza archivos, navega la web, crea documentos. Tus archivos no salen de tu equipo; solo el texto de tus misiones viaja al proveedor de IA que tú configures.',
    },
    {
      title: 'Inscribe una misión',
      body: 'Cada conversación es una misión. Escribe abajo lo que necesitas: «Ordena los archivos de mi escritorio por tipo» o «Busca las últimas noticias sobre IA y resúmemelas».',
    },
    {
      title: 'El Rastro',
      body: 'Mientras trabaja verás etiquetas como «Leyendo archivo» o «Navegando por la web»: son las acciones reales que Shinobi ejecuta. El panel derecho guarda el rastro completo — nada se esconde.',
    },
    {
      title: 'El candado',
      body: 'Antes de acciones sensibles (borrar, ejecutar comandos…) Shinobi se detiene y te pide permiso. Tú decides. Puedes ajustar cuánto pregunta en Ajustes → Candado.',
    },
    {
      title: 'Las habilidades ⟡',
      body: 'Pulsa ⟡ junto al compositor para ver lo que Shinobi sabe hacer. Mientras escribes, los chips ⟡ te anticipan qué habilidades despertará tu misión.',
    },
  ];
  let tourStep = 0;

  function renderTourStep() {
    const $indicator = document.getElementById('tour-step-indicator');
    const $tourTitle = document.getElementById('tour-title');
    const $tourBody = document.getElementById('tour-body');
    const $tourNext = document.getElementById('tour-next');
    const step = TOUR_STEPS[tourStep];
    if (!step) return;
    if ($indicator) $indicator.textContent = `${tourStep + 1} / ${TOUR_STEPS.length}`;
    if ($tourTitle) $tourTitle.textContent = step.title;
    if ($tourBody) $tourBody.textContent = step.body;
    if ($tourNext) $tourNext.textContent = tourStep < TOUR_STEPS.length - 1 ? 'Continuar →' : 'Empezar';
  }
  function startTour() {
    const $tourModal = document.getElementById('tour-modal');
    if (!$tourModal) return;
    tourStep = 0;
    renderTourStep();
    $tourModal.hidden = false;
  }
  function advanceTour() {
    tourStep++;
    if (tourStep >= TOUR_STEPS.length) closeTour();
    else renderTourStep();
  }
  function closeTour() {
    const $tourModal = document.getElementById('tour-modal');
    if ($tourModal) $tourModal.hidden = true;
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* sin memoria */ }
  }
  function maybeStartTour() {
    try {
      if (localStorage.getItem(TOUR_KEY) === '1') return;
    } catch { return; }
    setTimeout(startTour, 800); // que el dojo emerja primero
  }

  // ─── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // Composer
    if ($composer) {
      $composer.addEventListener('input', () => {
        autoResizeComposer();
        syncSlashMode();
        renderCmdPalette();
        renderSkillSuggestions();
      });
      $composer.addEventListener('keydown', (e) => {
        if (cmdPaletteKeydown(e)) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendCurrent();
        }
      });
      $composer.addEventListener('blur', () => setTimeout(hideCmdPalette, 120));
    }
    $sendBtn?.addEventListener('click', sendCurrent);

    // Sidebar
    $sidebarCollapse?.addEventListener('click', () => setSidebarCollapsed(true));
    $sidebarExpand?.addEventListener('click', () => setSidebarCollapsed(false));

    // Rastro
    $rightToggle?.addEventListener('click', () => {
      const open = $dojo?.getAttribute('data-right') === 'open';
      setRightOpen(!open);
    });
    $rightClose?.addEventListener('click', () => setRightOpen(false));

    // Tema (Hiru ↔ Yoru)
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

    // Candado
    $approvalYes?.addEventListener('click', () => closeApprovalModal('yes'));
    $approvalNo?.addEventListener('click', () => closeApprovalModal('no'));
    $approvalAlways?.addEventListener('click', () => closeApprovalModal('always'));

    // M6 — misiones de ejemplo del dojo vacío → rellenan el composer
    document.querySelectorAll('.dojo-ej').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!$composer) return;
        $composer.value = (btn.textContent || '').trim();
        $composer.focus();
        autoResizeComposer();
        renderSkillSuggestions();
      });
    });

    // A1 — botón ⟡ habilidades
    $skillsTriggerBtn?.addEventListener('click', () => toggleSkillsPanel());

    // A4 — tour
    document.getElementById('tour-next')?.addEventListener('click', advanceTour);
    document.getElementById('tour-skip')?.addEventListener('click', closeTour);

    setupTitleEditing();
    maybeTypeOpeningPhrase();

    // Conversaciones
    window.ShinobiConvs.onSelect(async (id) => {
      const c = window.ShinobiConvs.getActive();
      if ($title) $title.textContent = c?.title || '';
      await loadHistory(id);
    });
    window.ShinobiConvs.onChange(() => {
      const c = window.ShinobiConvs.getActive();
      if (c && $title) $title.textContent = c.title;
    });

    // WS primero (el send queda operativo en cuanto abre), luego el resto.
    connectWS();
    syncClima();
    loadCommands();
    loadSkills();
    await window.ShinobiConvs.init();
    maybeStartTour();
  });
})();
