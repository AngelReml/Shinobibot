// src/web/server.ts
//
// Bloque 1 — UI Web Chat. Express + WebSocket layer that wraps the existing
// ShinobiOrchestrator without modifying it. Designed to run as an alternative
// front-end to scripts/shinobi.ts (CLI). Both share src/coordinator/slash_commands.ts.
//
// Bloque 8.2 — extendido con conversations CRUD + WS protocol con
// conversationId (back-compat sessionId) + auto-title tras 3 mensajes
// del usuario via provider_router.
//
// Wire format (WS):
//   client → server : { type:'send',         text, conversationId?, sessionId? }
//   client → server : { type:'ask_response', text, requestId }
//   server → client : { type:'thinking_start' }
//   server → client : { type:'thinking',     line }
//   server → client : { type:'tool_call',    name }
//   server → client : { type:'ask',          question, requestId }
//   server → client : { type:'final',        response, mode, model, conversationId }
//   server → client : { type:'error',        message }
//   server → client : { type:'conversation_title_updated', conversationId, title }

import express from 'express';
import { buildA2ADispatcher, shinobiAgentCard } from '../a2a/a2a_wiring.js';
import { startChannels } from '../channels/channels_wiring.js';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import { handleSlashCommand, SLASH_COMMANDS } from '../coordinator/slash_commands.js';
import { runExclusive } from '../coordinator/orchestrator_mutex.js';
import { ResidentLoop } from '../runtime/resident_loop.js';
import { setSkillEventListener, skillManager } from '../skills/skill_manager.js';
import { setDocumentEventListener, shouldOfferDocument, offerDocument } from '../documents/factory.js';
import { loadConfig, saveConfig, reloadConfig, type ShinobiConfig } from '../runtime/first_run_wizard.js';
import { getClient, getAllUserFacingClients, currentProvider, invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { EXTRA_MODEL_SUGGESTIONS } from '../providers/registry.js';
import { tokenBudget } from '../context/token_budget.js';
import { toolEvents } from '../coordinator/tool_events.js';
import { setBrowserConsentAsker } from '../browser/consent.js';
import { screencastHub } from '../browser/screencast.js';
import {
  ensureApprovalModeInitialized,
  setApprovalAsker,
  getApprovalMode,
  setApprovalMode,
  type Approval,
  type ApprovalMode,
} from '../security/approval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ChatStore extraído a src/web/chat_store.ts (Bloque 6) para reusarlo desde
// el gateway HTTP + Telegram sin duplicar el código de persistencia.
import { ChatStore } from './chat_store.js';

// A1 — tipos para el endpoint /api/skills
interface SkillEntry {
  id: string;
  name: string;
  description: string;
  trigger_keywords: string[];
  source: 'native' | 'skill';
}

function stringifyArgs(args: any[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

/**
 * ¿La config tiene credenciales utilizables? Punto único de verdad para el
 * onboarding: `GET /`, `/api/onboarding/status` y `/api/onboarding/skip`
 * deben coincidir, o el skip "aprueba" una config que `GET /` rechaza y el
 * usuario queda atrapado en un bucle de onboarding (FIX-001).
 */
function isConfigUsable(cfg: any): boolean {
  // Extirpación OG (D-extirpación, 2026-06-12): la rama legacy
  // opengravity_api_key ya NO cuenta como config usable — OpenGravity no
  // provee LLM. Una config solo-OG debe ir a onboarding, no al dojo roto.
  return !!(cfg?.provider && cfg?.provider_key);
}

export interface StartWebServerOptions {
  port?: number;
  dbPath?: string;
  /** Ruta donde viven los assets web. Si no se pasa, se asume
   *  path.join(__dirname, 'public'). Necesario para builds pkg.exe que
   *  extraen los assets a APPDATA (Bloque 9). */
  publicPath?: string;
}

/**
 * Bloque 8.2 — Genera un título corto para la conversación en background.
 * Llamado tras el 3er mensaje del usuario. No bloquea el WS; emite
 * `conversation_title_updated` cuando termina.
 */
// Títulos por defecto que el auto-generador puede sobreescribir (M1).
const AUTO_TITLE_DEFAULTS = new Set([
  'Conversación nueva',
  'Conversación',
  'Conversación inicial',
]);

/** Fallback heurístico: primeras ~6 palabras del primer mensaje del usuario. */
function heuristicTitle(seeds: string[]): string {
  const first = (seeds[0] ?? '').trim();
  if (!first) return '';
  const words = first.replace(/\s+/g, ' ').split(' ');
  let title = words.slice(0, 6).join(' ');
  if (words.length > 6) title = title + '…';
  if (title.length > 60) title = title.slice(0, 57).trim() + '…';
  return title;
}

async function maybeGenerateAutoTitle(
  store: ChatStore,
  conversationId: string,
  broadcast: (payload: any) => void,
): Promise<void> {
  try {
    const conv = store.getConversation(conversationId);
    if (!conv) return;
    // No autorrenombrar si el usuario ya lo personalizó.
    if (!AUTO_TITLE_DEFAULTS.has(conv.title)) return;
    const count = store.countUserMessages(conversationId);
    if (count < 1) return; // al menos un mensaje
    const seeds = store.firstUserMessages(conversationId, 3);
    if (seeds.length === 0) return;
    const numbered = seeds.map((s, i) => `${i + 1}. ${s.slice(0, 240)}`).join('\n');
    const result = await routedInvokeLLM({
      messages: [
        { role: 'system', content: 'Eres un generador de títulos. Devuelve UN solo título conciso en español, de 3 a 5 palabras, sin comillas, sin puntuación final, sin etiquetas. Solo el título.' },
        { role: 'user', content: `Mensajes del usuario:\n${numbered}\n\nTítulo:` },
      ],
      temperature: 0.3,
      max_tokens: 30,
    });
    let title = '';
    if (!result.success) {
      // Fallback heurístico: primeras palabras del primer mensaje (sin LLM).
      title = heuristicTitle(seeds);
      console.log(`[auto-title] LLM failed, using heuristic: '${title}' (error: ${result.error})`);
    } else {
      let raw = '';
      try {
        const parsed = JSON.parse(result.output);
        raw = String(parsed?.content ?? parsed?.message?.content ?? parsed?.text ?? '').trim();
      } catch { raw = String(result.output ?? '').trim(); }
      // Saneo: 1 línea, sin comillas, recortado.
      title = raw.split(/\r?\n/)[0].trim();
      title = title.replace(/^[“”'`]+|[“”'`]+$/g, '').replace(/[.!?…]+$/g, '').trim();
      if (title.length > 60) title = title.slice(0, 57).trim() + '…';
      // Si el LLM devuelve vacío, fallback heurístico.
      if (!title) {
        title = heuristicTitle(seeds);
        console.log(`[auto-title] LLM returned empty, using heuristic: '${title}'`);
      }
    }
    if (!title) { console.log('[auto-title] no title generated'); return; }
    store.updateTitle(conversationId, title);
    console.log(`[auto-title] '${conversationId}' → '${title}'`);
    broadcast({ type: 'conversation_title_updated', conversationId, title });
  } catch (e: any) {
    console.log(`[auto-title] threw: ${e?.message ?? e}`);
  }
}

export async function startWebServer(opts: StartWebServerOptions = {}): Promise<{ url: string }> {
  const port = opts.port ?? 3333;
  const dbPath = opts.dbPath ?? path.join(process.cwd(), 'web_chat.db');
  const publicPath = opts.publicPath ?? path.join(__dirname, 'public');
  const store = new ChatStore(dbPath);
  const residentLoop = new ResidentLoop();

  // D-017: ensure approval_mode field exists.
  ensureApprovalModeInitialized();

  const app = express();
  // Límite de body: sin esto un POST gigante a /api/* agota memoria (DoS).
  app.use(express.json({ limit: '1mb' }));

  // ─── Bloque 7 — onboarding: si no hay config, sirve la pantalla de bienvenida en `/` ─
  app.get('/', (_req, res, next) => {
    const cfg = loadConfig();
    if (!isConfigUsable(cfg)) {
      res.sendFile(path.join(publicPath, 'onboarding.html'));
      return;
    }
    next();
  });

  app.use(express.static(publicPath));

  // ─── Bloque 7 — endpoints de onboarding ───────────────────────────────────
  app.get('/api/onboarding/status', (_req, res) => {
    const cfg = loadConfig();
    res.json({
      configured: isConfigUsable(cfg),
      currentProvider: currentProvider(),
      providerLabel: cfg?.provider || null,
      modelDefault: cfg?.model_default || null,
    });
  });

  app.post('/api/onboarding', async (req, res) => {
    const body = req.body ?? {};
    const provider = String(body.provider || '').toLowerCase();
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!provider || !key) {
      res.status(400).json({ ok: false, error: 'provider y key son requeridos' });
      return;
    }
    if (!['groq', 'openai', 'anthropic', 'openrouter'].includes(provider)) {
      res.status(400).json({ ok: false, error: `provider desconocido: ${provider}` });
      return;
    }
    const client = getClient(provider as any);
    if (!client) {
      res.status(500).json({ ok: false, error: `cliente para ${provider} no encontrado` });
      return;
    }
    try {
      const validation = await client.validateKey(key);
      if (!validation.ok) {
        res.status(400).json({ ok: false, error: validation.error || 'Key inválida.' });
        return;
      }
      // Construye config — preserva campos legacy si existían.
      const prev = loadConfig();
      const newCfg: ShinobiConfig = {
        opengravity_api_key: prev?.opengravity_api_key ?? '',
        opengravity_url: prev?.opengravity_url ?? '',
        language: prev?.language || 'es',
        memory_path: prev?.memory_path || path.join(process.env.APPDATA || process.env.HOME || '', 'Shinobi', 'memory'),
        onboarded_at: prev?.onboarded_at || new Date().toISOString(),
        version: prev?.version || '2.0.0',
        provider: provider as ShinobiConfig['provider'],
        provider_key: key,
        model_default: client.defaultModel(),
      };
      saveConfig(newCfg);
      reloadConfig(); // hot reload: actualiza process.env en este mismo proceso
      console.log(`[onboarding] provider=${provider} guardado y env recargada. defaultModel=${client.defaultModel()}`);
      res.json({ ok: true, provider, modelDefault: client.defaultModel() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: `error inesperado: ${e?.message ?? e}` });
    }
  });

  app.post('/api/onboarding/skip', (_req, res) => {
    const cfg = loadConfig();
    if (!cfg || !isConfigUsable(cfg)) {
      res.status(400).json({ ok: false, error: 'config incompleta: falta provider_key' });
      return;
    }
    // Asegura que process.env refleja la config legacy presente.
    reloadConfig();
    res.json({ ok: true, currentProvider: currentProvider() });
  });

  // ─── Bloque 8.2 — endpoints de conversaciones ──────────────────────────────

  app.get('/api/conversations', (_req, res) => {
    res.json({ conversations: store.listConversations() });
  });

  app.post('/api/conversations', (req, res) => {
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim().slice(0, 60)
      : 'Conversación nueva';
    const conv = store.createConversation(title);
    res.json({ conversation: conv });
  });

  app.get('/api/conversations/:id/messages', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const rows = store.listByConversation(id, 500);
    res.json({
      conversationId: id,
      messages: rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        thinking: r.thinking_json ? JSON.parse(r.thinking_json) : [],
        ts: r.ts,
      })),
    });
  });

  app.patch('/api/conversations/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 60) : '';
    if (!id || !title) { res.status(400).json({ error: 'id and title required' }); return; }
    const ok = store.updateTitle(id, title);
    if (!ok) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ok: true });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const ok = store.deleteConversation(id);
    if (!ok) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ok: true });
  });

  // Back-compat: GET /api/history?session=X — el gateway sigue usándolo.
  app.get('/api/history', (req, res) => {
    const sessionId = String(req.query.session || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'session query param required' });
      return;
    }
    const rows = store.list(sessionId, 200);
    res.json({
      messages: rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        thinking: r.thinking_json ? JSON.parse(r.thinking_json) : [],
        ts: r.ts,
      })),
    });
  });

  // Bloque 8.5 — La UI lee las capacidades del backend, no las inventa:
  // paleta de comandos "/" y pergamino (Ctrl+/) consumen este endpoint.
  app.get('/api/commands', (_req, res) => {
    res.json({ commands: SLASH_COMMANDS });
  });

  // ─── Bloque 8.6 — Settings, modelos y búsqueda ─────────────────────────
  // Inspirado en la organización de Odysseus (panel de settings + gestor de
  // proveedores + selector de modelo + búsqueda global), traducido a la marca.
  // La UI lee/escribe el estado real del agente; nada hardcodeado.

  // Proveedores configurables (Bloque 7) + el activo. Reusa el registro real.
  app.get('/api/providers', (_req, res) => {
    const cur = currentProvider();
    const providers = getAllUserFacingClients().map((c) => ({
      name: c.name,
      label: c.label(),
      defaultModel: c.defaultModel(),
      signupUrl: c.signupUrl(),
      active: c.name === cur,
    }));
    res.json({ providers, current: cur });
  });

  // Modelos sugeridos para el selector. Override manual = bypassea el router.
  // 'auto' (model undefined) deja decidir al router por tier. Incluye los
  // modelos del registro extra (Bloque 7.2): glm/gemini/deepseek/hf + local.
  app.get('/api/models', (_req, res) => {
    const localModel = process.env.SHINOBI_LOCAL_MODEL;
    res.json({
      active: ShinobiOrchestrator.getModel(),
      models: [
        { id: 'auto', label: 'Auto — el router decide por tier', tier: '—' },
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', tier: 'fast' },
        { id: 'gpt-4o', label: 'GPT-4o', tier: 'balanced' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'balanced' },
        ...EXTRA_MODEL_SUGGESTIONS,
        ...(localModel ? [{ id: localModel, label: `Local · ${localModel}`, tier: 'local' }] : []),
      ],
    });
  });

  // Cambiar modelo en caliente. 'auto'/'' → setModel(undefined).
  app.post('/api/model', (req, res) => {
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    ShinobiOrchestrator.setModel(model && model !== 'auto' ? model : undefined);
    res.json({ ok: true, active: ShinobiOrchestrator.getModel() });
  });

  // Cambiar modo del candado (§11). El gate persiste en config.json.
  app.post('/api/approval', (req, res) => {
    const mode = String(req.body?.mode || '').toLowerCase();
    if (!['on', 'smart', 'critical', 'off'].includes(mode)) {
      res.status(400).json({ ok: false, error: 'modo inválido (on|smart|critical|off)' });
      return;
    }
    setApprovalMode(mode as ApprovalMode);
    res.json({ ok: true, approval: getApprovalMode() });
  });

  // Probar una key SIN guardarla (el gestor de proveedores). Para guardar se
  // usa POST /api/onboarding, que valida y persiste.
  app.post('/api/providers/test', async (req, res) => {
    const provider = String(req.body?.provider || '').toLowerCase();
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!provider || !key) {
      res.status(400).json({ ok: false, error: 'provider y key requeridos' });
      return;
    }
    const client = getClient(provider as any);
    if (!client) {
      res.status(400).json({ ok: false, error: `provider desconocido: ${provider}` });
      return;
    }
    try {
      const v = await client.validateKey(key);
      res.json({ ok: v.ok, error: v.error, status: v.status });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Búsqueda global DENTRO del contenido de los mensajes (no solo títulos).
  app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) { res.json({ query: '', results: [] }); return; }
    res.json({ query: q, results: store.searchMessages(q, 40) });
  });

  // A1 — Habilidades visibles: expone skills aprobadas + capacidades nativas
  // para que la UI muestre chips en el composer y un panel ⟡.
  app.get('/api/skills', (_req, res) => {
    const sm = skillManager();

    // Capacidades nativas troncales (curadas a mano, A1 del plan).
    const NATIVE: SkillEntry[] = [
      { id: 'native-files', name: 'Archivos y carpetas', description: 'Leer, escribir, mover, borrar, listar archivos y carpetas en tu máquina.', trigger_keywords: ['archivo', 'carpeta', 'fichero', 'directorio', 'organizar', 'mover', 'renombrar', 'borrar', 'crear'], source: 'native' },
      { id: 'native-shell', name: 'Comandos del sistema', description: 'Ejecutar comandos en la terminal de Windows (PowerShell / cmd).', trigger_keywords: ['comando', 'terminal', 'powershell', 'ejecutar', 'script', 'instalar', 'consola'], source: 'native' },
      { id: 'native-browser', name: 'Navegador web (Kage)', description: 'Abrir páginas web, hacer clic, rellenar formularios, extraer información.', trigger_keywords: ['web', 'navegador', 'página', 'url', 'buscar', 'abrir', 'chrome', 'formulario', 'scraping'], source: 'native' },
      { id: 'native-documents', name: 'Documentos (Word · PDF · Excel)', description: 'Generar y editar documentos Word, PDF, Excel y Markdown.', trigger_keywords: ['word', 'pdf', 'excel', 'documento', 'informe', 'tabla', 'markdown', 'generar'], source: 'native' },
      { id: 'native-memory', name: 'Memoria persistente', description: 'Guardar y recuperar información entre sesiones (/memory store · recall).', trigger_keywords: ['memoria', 'recordar', 'guardar', 'olvida', 'aprender', 'recall'], source: 'native' },
      { id: 'native-sentinel', name: 'Sentinel — vigilancia web', description: 'Vigilar páginas web y canales; avisar cuando hay cambios relevantes.', trigger_keywords: ['vigilar', 'monitorear', 'avisar', 'alerta', 'sentinel', 'cambio', 'seguimiento'], source: 'native' },
    ];

    // Skills aprobadas del manager. loadApproved() relee skills/approved/ y
    // refresca el índice in-memory (barato: pocos ficheros .skill.md). El
    // array `approved` es privado en SkillManagerImpl — lectura via cast.
    // TODO honesto: exponer listApproved() público en skill_manager y
    // eliminar este cast (anotado en DECISIONES.md).
    const approvedSkills: SkillEntry[] = [];
    try {
      const result = sm.loadApproved();
      if (result.count > 0) {
        const smAny = sm as any;
        if (Array.isArray(smAny.approved)) {
          for (const s of smAny.approved) {
            approvedSkills.push({
              id: String(s.id || ''),
              name: String(s.frontmatter?.name || s.id || ''),
              description: String(s.frontmatter?.description || ''),
              trigger_keywords: Array.isArray(s.frontmatter?.trigger_keywords)
                ? s.frontmatter.trigger_keywords.map(String)
                : [],
              source: 'skill',
            });
          }
        }
      }
    } catch { /* si falla, solo mostramos las nativas */ }

    res.json({ skills: [...NATIVE, ...approvedSkills] });
  });

  app.get('/api/status', async (_req, res) => {
    res.json({
      model: ShinobiOrchestrator.getModel(),
      mode: 'local',
      approval: getApprovalMode(),
    });
  });

  // Tier B #14 — Token budget visible. WebChat / TUI pueden mostrar el
  // contador "Xk / Yk tokens" en cabecera. Hermes y OpenClaw ocultan
  // esto; Shinobi lo expone como trust signal.
  app.get('/api/token-budget', (req, res) => {
    const sessionId = (req.query.sessionId as string) || 'default';
    const snap = tokenBudget().get(sessionId);
    if (!snap) {
      res.json({ sessionId, usedTokens: 0, budgetTokens: Number(process.env.SHINOBI_CONTEXT_BUDGET) || 32_000, ratio: 0, turns: 0 });
      return;
    }
    res.json(snap);
  });

  // Sprint 2.4 — Admin dashboard + metrics + Prometheus.
  app.get('/admin/dashboard', async (_req, res) => {
    const { renderDashboardHtml } = await import('../observability/admin_dashboard.js');
    const r = renderDashboardHtml();
    res.type(r.contentType).send(r.body);
  });
  app.get('/admin/metrics/json', async (_req, res) => {
    const { snapshotJsonResponse } = await import('../observability/admin_dashboard.js');
    const r = snapshotJsonResponse();
    res.type(r.contentType).send(r.body);
  });
  app.get('/admin/metrics/prom', async (_req, res) => {
    const { prometheusResponse } = await import('../observability/admin_dashboard.js');
    const r = prometheusResponse();
    res.type(r.contentType).send(r.body);
  });

  // P2 — A2A: discovery + dispatch para que otro agente invoque a Shinobi.
  const a2aDispatcher = buildA2ADispatcher();
  // Rate-limit por IP para /a2a (ventana fija). Evita que un peer abuse del
  // dispatch, especialmente cuando auth='none' (sin SHINOBI_A2A_SECRET).
  const a2aHits = new Map<string, { count: number; windowStart: number }>();
  const A2A_WINDOW_MS = 60_000;
  const A2A_MAX = Number(process.env.SHINOBI_A2A_RATE_LIMIT) || 60;
  const a2aRateLimited = (ip: string): boolean => {
    const now = Date.now();
    if (a2aHits.size > 500) {
      for (const [k, v] of a2aHits) if (now - v.windowStart > A2A_WINDOW_MS) a2aHits.delete(k);
    }
    const e = a2aHits.get(ip);
    if (!e || now - e.windowStart > A2A_WINDOW_MS) {
      a2aHits.set(ip, { count: 1, windowStart: now });
      return false;
    }
    e.count++;
    return e.count > A2A_MAX;
  };
  app.get('/.well-known/agent-card.json', (req, res) => {
    // El endpoint anunciado sale de SHINOBI_PUBLIC_URL si está configurado;
    // si no, del Host de la petición (uso LAN). En despliegue público NO se
    // debe confiar el Host: uno falsificado envenenaría el discovery.
    const base = process.env.SHINOBI_PUBLIC_URL?.replace(/\/+$/, '') || `http://${req.headers.host}`;
    res.json(shinobiAgentCard(`${base}/a2a`));
  });
  app.post('/a2a', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (a2aRateLimited(ip)) {
      res.status(429).json({ ok: false, error: 'rate limit exceeded' });
      return;
    }
    const resp = await a2aDispatcher.dispatch(req.body, {
      bearer: (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || undefined,
      signature: typeof req.headers['x-a2a-signature'] === 'string' ? req.headers['x-a2a-signature'] : undefined,
      rawBody: JSON.stringify(req.body),
    });
    res.status(resp.ok ? 200 : 400).json(resp);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // ─── Broadcast helpers ────────────────────────────────────────────────────
  const allClients = new Set<import('ws').WebSocket>();
  const broadcastAll = (payload: any) => {
    const s = JSON.stringify(payload);
    for (const c of allClients) {
      try { c.send(s); } catch { /* ignore */ }
    }
  };

  const pendingApprovals = new Map<string, (v: Approval) => void>();
  setApprovalAsker(async (promptText: string): Promise<Approval> => {
    if (allClients.size === 0) {
      if (process.env.SHINOBI_DEBUG === '1') console.log(`[DIAG-SERVER] [${new Date().toISOString()}] No clients connected, denying approval request.`);
      return 'no';
    }
    return new Promise((resolve) => {
      const requestId = randomUUID();
      pendingApprovals.set(requestId, resolve);
      if (process.env.SHINOBI_DEBUG === '1') console.log(`[DIAG-SERVER] [${new Date().toISOString()}] Emitiendo approval_request a ${allClients.size} cliente(s).`);
      // A3 — extraer nombre de tool del promptText para que la UI muestre descripción legible.
      const toolMatch = promptText.match(/Acción que requiere tu permiso:\s*"([^"]+)"/);
      const tool = toolMatch ? toolMatch[1] : null;
      broadcastAll({ type: 'approval_request', promptText, requestId, tool });
    });
  });

  // Bloque 3: broadcast skill lifecycle events to every connected UI client.
  setSkillEventListener((event) => broadcastAll({ type: 'skill_event', event }));

  // Bloque 5: broadcast document lifecycle events.
  setDocumentEventListener((event) => {
    console.log(`[auto-offer] server broadcasting document_event to ${allClients.size} client(s); event.type=${event.type}`);
    broadcastAll({ type: 'document_event', event });
  });

  // Tier B #15 — broadcast de tool execution events para que el WebChat
  // muestre "🔨 run_command ejecutándose…" en tiempo real en lugar de
  // esperar al final del loop.
  toolEvents().on('tool_event', (event: any) => {
    broadcastAll({ type: 'tool_event', event });
  });

  // Subsistema de navegador "Kage": consentimiento de acciones sensibles. Usa
  // el MISMO canal de aprobaciones (approval_request/approval_response +
  // pendingApprovals) que ya existe, pero el asker devuelve boolean. Política
  // timeout-deny la aplica consent.ts; aquí solo preguntamos. Ver
  // docs/BROWSER_SUBSYSTEM.md §1.5.
  setBrowserConsentAsker(async (promptText: string): Promise<boolean> => {
    if (allClients.size === 0) return false; // sin UI → fail-safe deny
    return new Promise<boolean>((resolve) => {
      const requestId = randomUUID();
      let done = false;
      // finish() es idempotente: borra la entrada del mapa (evita fuga si el
      // usuario nunca responde) y resuelve una sola vez.
      const finish = (val: boolean) => {
        if (done) return;
        done = true;
        pendingApprovals.delete(requestId);
        resolve(val);
      };
      pendingApprovals.set(requestId, (ans: Approval) => finish(ans === 'yes' || ans === 'always'));
      broadcastAll({ type: 'approval_request', promptText, requestId, kind: 'browser_consent' });
      // Auto-limpieza: consent.ts ya deniega por su propio timeout; esto solo
      // garantiza que la entrada no quede huérfana. Margen de 5s para que el
      // deny autoritativo lo emita consent.ts primero.
      const ms = Number(process.env.KAGE_CONSENT_TIMEOUT_MS) || 60_000;
      setTimeout(() => finish(false), ms + 5_000);
    });
  });

  // Screencast del navegador → frames en vivo al panel (browser.html).
  screencastHub().on('frame', (frame: { dataB64: string; ts: number }) => {
    broadcastAll({ type: 'browser_frame', dataB64: frame.dataB64, ts: frame.ts });
  });

  // Serial queue: only one in-flight request per server. The orchestrator
  // holds shared static state and we monkey-patch console during processing,
  // so concurrent requests would mix output streams.
  let busy = false;

  wss.on('connection', (ws, request) => {
    // Anti-CSWSH: rechaza upgrades cuyo Origin no coincide con el host del
    // server. Una página maliciosa que el usuario visite NO debe poder abrir
    // un WebSocket contra su Shinobi local y pilotar el orchestrator. Un
    // cliente no-browser no envía Origin (no puede montar el ataque). Para
    // redes no confiables conviene además un token — ver nota de la auditoría.
    const origin = request.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* origin malformado */ }
      if (originHost !== request.headers.host) {
        console.warn(`[webchat] WS rechazado — Origin '${origin}' no coincide con host '${request.headers.host}'`);
        try { ws.close(1008, 'origin not allowed'); } catch { /* ya cerrado */ }
        return;
      }
    }
    allClients.add(ws);
    let pendingAsk: { resolve: (v: string) => void; requestId: string } | null = null;

    const ask = (q: string): Promise<string> => new Promise((resolve) => {
      const requestId = randomUUID();
      pendingAsk = { resolve, requestId };
      try { ws.send(JSON.stringify({ type: 'ask', question: q, requestId })); } catch { /* ws closed */ }
    });

    ws.on('message', async (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      if (msg.type === 'ask_response' && pendingAsk && msg.requestId === pendingAsk.requestId) {
        const r = pendingAsk;
        pendingAsk = null;
        r.resolve(String(msg.text ?? ''));
        return;
      }

      if (msg.type === 'approval_response' && msg.requestId) {
        const resolve = pendingApprovals.get(msg.requestId);
        if (resolve) {
          pendingApprovals.delete(msg.requestId);
          // msg.answer debe ser 'yes', 'no' o 'always'
          resolve((msg.answer as Approval) || 'no');
        }
        return;
      }

      if (msg.type !== 'send') return;
      const text = String(msg.text ?? '').trim();
      // Bloque 8.2 — preferir conversationId, fallback a sessionId (gateway).
      const conversationId = String(msg.conversationId ?? msg.sessionId ?? 'default');
      if (!text) return;

      if (busy) {
        ws.send(JSON.stringify({ type: 'error', message: 'Shinobi está ocupado con otra petición — espera a que termine.' }));
        return;
      }
      busy = true;

      store.ensureConversation(conversationId, 'Conversación nueva');
      store.addInConversation(conversationId, 'user', text, null);
      // Bloque 7.1 — aísla el contexto del agente por conversación. Sin esto el
      // historial era global y cada misión arrastraba el contexto de la anterior
      // (un "ping" pedía 30k tokens y reventaba el TPM de los proveedores).
      ShinobiOrchestrator.setConversation(conversationId);
      ws.send(JSON.stringify({ type: 'thinking_start' }));

      // Mutex global del orchestrator: serializa esta petición WebChat con
      // los mensajes de canal (channels_wiring usa el mismo runExclusive).
      // El orchestrator tiene estado estático y el monkey-patch de console
      // es global — sin esto, un mensaje de canal concurrente correría
      // process() mientras WebChat tiene console parcheado y su salida se
      // colaría en el stream de razonamiento del WebChat. El parche de
      // console DEBE quedar dentro de la sección exclusiva.
      await runExclusive(async () => {

      // Console capture: monkey-patch console.{log,error,warn,info} so every
      // line the orchestrator (or a slash handler) prints during this request
      // is forwarded to the UI as a `thinking` event. Originals still run so
      // the server terminal keeps its log.
      const captured: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      const origWarn = console.warn;
      const origInfo = console.info;
      const send = (line: string) => {
        captured.push(line);
        // Estrategia dual para detectar tool_call: el regex primario busca el
        // emoji [🔨] que el orchestrator emite; el fallback busca el texto ASCII
        // 'Tool called:' por si el emoji cambia o se pierde en el log pipeline.
        const toolMatchEmoji = line.match(/\[🔨\]\s+Tool called:\s+(\S+)/);
        const toolMatchAscii = toolMatchEmoji ? null : line.match(/Tool called:\s+(\S+)/);
        const toolName = (toolMatchEmoji ?? toolMatchAscii)?.[1];
        if (toolName) {
          try { ws.send(JSON.stringify({ type: 'tool_call', name: toolName })); } catch {}
        }
        // Razonamiento/plan del modelo ([🧠], auditoría 2026-06-06) y skills
        // activadas ([🧩]): se emiten con tipo propio para que la UI pueda
        // renderizarlos como confirmación visual destacada, no como log plano.
        const planMatch = line.match(/\[🧠\]\s+(.*)/);
        if (planMatch) {
          try { ws.send(JSON.stringify({ type: 'plan', text: planMatch[1] })); } catch {}
        }
        const skillMatch = line.match(/\[🧩\]\s+(.*)/);
        if (skillMatch) {
          try { ws.send(JSON.stringify({ type: 'skill_activated', text: skillMatch[1] })); } catch {}
        }
        try { ws.send(JSON.stringify({ type: 'thinking', line })); } catch {}
      };
      console.log = (...args: any[]) => { send(stringifyArgs(args)); origLog(...args); };
      console.error = (...args: any[]) => { send(stringifyArgs(args)); origErr(...args); };
      console.warn = (...args: any[]) => { send(stringifyArgs(args)); origWarn(...args); };
      console.info = (...args: any[]) => { send(stringifyArgs(args)); origInfo(...args); };

      let finalResponse = '';
      try {
        if (text.startsWith('/')) {
          const handled = await handleSlashCommand(text, { residentLoop, ask });
          if (handled) {
            finalResponse = '(comando ejecutado — ver el panel de razonamiento)';
          } else {
            const cmd = text.split(/\s+/)[0];
            console.log(`[shinobi-web] Slash desconocido: ${cmd} — bloqueado para no enviarlo al LLM.`);
            finalResponse = `Comando no reconocido: ${cmd}. Quita la "/" si querías hablar con el LLM, o tipea uno de los comandos válidos.`;
          }
        } else {
          const result: any = await ShinobiOrchestrator.process(text);
          if (result?.response) finalResponse = String(result.response);
          else if (result?.output) finalResponse = String(result.output);
          else finalResponse = JSON.stringify(result, null, 2);
        }
        store.addInConversation(conversationId, 'agent', finalResponse, captured);
        try {
          ws.send(JSON.stringify({
            type: 'final',
            response: finalResponse,
            mode: 'local', // D4 extirpación: constante un release, luego se retira
            model: ShinobiOrchestrator.getModel(),
            conversationId,
          }));
        } catch {}

        // Restaurar console ANTES del auto-offer hook y del auto-title async.
        // Si no, los console.log de esos hooks se envían como `thinking` events
        // al cliente — que entonces crea un nuevo bubble agente "pending" fantasma.
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        console.info = origInfo;

        // Bloque 8.2 — auto-title fire-and-forget tras el 3er mensaje del usuario.
        // No bloquea: el WS final ya fue enviado.
        maybeGenerateAutoTitle(store, conversationId, broadcastAll).catch(() => { /* swallowed */ });

        // Bloque 5.3 — auto-offer hook. Punto único de convergencia: aquí
        // confluyen slash flow + LLM flow + cualquier futuro path. La
        // respuesta YA fue enviada al UI; ahora chequeamos si su contenido
        // tiene estructura y disparamos document_offer (toast).
        const _respLen = finalResponse.length;
        const _heuristic = shouldOfferDocument(finalResponse);
        const _alreadyGen = captured.some(line => /\[🔨\]\s+Tool called:\s+generate_document/.test(line));
        console.log(`[auto-offer] post-task hook fired, content length=${_respLen}, alreadyGenerated=${_alreadyGen}`);
        console.log(`[auto-offer] shouldOfferDocument result: ${_heuristic}`);
        if (_heuristic && !_alreadyGen) {
          console.log('[auto-offer] broadcasting document_offer event');
          offerDocument('Esta respuesta tiene formato. Usa /doc auto "<descripción>" para generar Word/PDF/Excel/Markdown.');
        } else {
          const reasons: string[] = [];
          if (!_heuristic) reasons.push('heuristic=false');
          if (_alreadyGen) reasons.push('generate_document already called');
          console.log(`[auto-offer] SKIPPED — ${reasons.join('; ') || '(unknown)'}`);
        }
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        store.addInConversation(conversationId, 'system', `[error] ${errMsg}`, captured);
        try { ws.send(JSON.stringify({ type: 'error', message: errMsg })); } catch {}
      } finally {
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        console.info = origInfo;
        busy = false;
      }
      }); // fin runExclusive — sección exclusiva con canales
    });

    ws.on('close', () => {
      allClients.delete(ws);
      if (pendingAsk) {
        // Resolve any outstanding ask with empty so the awaiting code unblocks.
        pendingAsk.resolve('');
        pendingAsk = null;
      }
    });
  });

  // P2 — arranca el subsistema de canales (Loopback siempre; Webhook si
  // SHINOBI_WEBHOOK_ENABLED=1). Los mensajes entrantes van al orchestrator.
  try {
    const ch = await startChannels();
    console.log(`[shinobi-web] Canales: arrancados=[${ch.started.join(', ')}], skipped=[${ch.skipped.join(', ')}]`);
  } catch (e: any) {
    console.error('[shinobi-web] startChannels error:', e?.message ?? e);
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[shinobi-web] Listening on http://localhost:${port}`);
      resolve({ url: `http://localhost:${port}` });
    });
  });
}
