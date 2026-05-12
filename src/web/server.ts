// src/web/server.ts
//
// Bloque 1 — UI Web Chat. Express + WebSocket layer that wraps the existing
// ShinobiOrchestrator without modifying it. Designed to run as an alternative
// front-end to scripts/shinobi.ts (CLI). Both share src/coordinator/slash_commands.ts.
//
// Wire format (WS):
//   client → server : { type:'send',         text, sessionId }
//   client → server : { type:'ask_response', text, requestId }
//   server → client : { type:'thinking_start' }
//   server → client : { type:'thinking',     line }
//   server → client : { type:'tool_call',    name }
//   server → client : { type:'ask',          question, requestId }
//   server → client : { type:'final',        response, mode, model }
//   server → client : { type:'error',        message }

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import { handleSlashCommand } from '../coordinator/slash_commands.js';
import { ResidentLoop } from '../runtime/resident_loop.js';
import { KernelClient } from '../bridge/kernel_client.js';
import { setSkillEventListener } from '../skills/skill_manager.js';
import { setDocumentEventListener, shouldOfferDocument, offerDocument } from '../documents/factory.js';
import { loadConfig, saveConfig, reloadConfig, type ShinobiConfig } from '../runtime/first_run_wizard.js';
import { getClient, currentProvider } from '../providers/provider_router.js';
import {
  ensureApprovalModeInitialized,
  setApprovalAsker,
  getApprovalMode,
  type Approval,
} from '../security/approval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ChatStore extraído a src/web/chat_store.ts (Bloque 6) para reusarlo desde
// el gateway HTTP + Telegram sin duplicar el código de persistencia.
import { ChatStore } from './chat_store.js';

function stringifyArgs(args: any[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

export interface StartWebServerOptions {
  port?: number;
  dbPath?: string;
}

export async function startWebServer(opts: StartWebServerOptions = {}): Promise<{ url: string }> {
  const port = opts.port ?? 3333;
  const dbPath = opts.dbPath ?? path.join(process.cwd(), 'web_chat.db');
  const store = new ChatStore(dbPath);
  const residentLoop = new ResidentLoop();

  // D-017: ensure approval_mode field exists. The web UI does not yet route
  // approval prompts through a modal — install a deny-by-default asker for v1.
  // Future iteration: emit a `type:'approval_request'` WS event and wait.
  ensureApprovalModeInitialized();
  setApprovalAsker(async (_p: string): Promise<Approval> => 'no');

  const app = express();
  app.use(express.json());

  // ─── Bloque 7 — onboarding: si no hay config, sirve la pantalla de bienvenida en `/` ─
  app.get('/', (_req, res, next) => {
    const cfg = loadConfig();
    const hasUsableConfig = !!cfg && (
      (cfg.provider && cfg.provider_key) ||           // provider Bloque 7 configurado
      (cfg.opengravity_api_key && cfg.opengravity_url) // o config legacy OpenGravity
    );
    if (!hasUsableConfig) {
      res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
      return;
    }
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // ─── Bloque 7 — endpoints de onboarding ───────────────────────────────────
  app.get('/api/onboarding/status', (_req, res) => {
    const cfg = loadConfig();
    res.json({
      configured: !!cfg && ((cfg.provider && cfg.provider_key) || (cfg.opengravity_api_key && cfg.opengravity_url)),
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
        opengravity_api_key: prev?.opengravity_api_key || '',
        opengravity_url: prev?.opengravity_url || '',
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
    if (!cfg) {
      res.status(400).json({ ok: false, error: 'No hay config previa. Configura una key arriba.' });
      return;
    }
    // Asegura que process.env refleja la config legacy presente.
    reloadConfig();
    res.json({ ok: true, currentProvider: currentProvider() });
  });

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

  app.get('/api/status', async (_req, res) => {
    const kernelOnline = await KernelClient.isOnline();
    res.json({
      model: ShinobiOrchestrator.getModel(),
      kernelOnline,
      mode: (ShinobiOrchestrator as any).mode ?? 'kernel',
      approval: getApprovalMode(),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Bloque 3: broadcast skill lifecycle events to every connected UI client.
  const allClients = new Set<import('ws').WebSocket>();
  setSkillEventListener((event) => {
    const payload = JSON.stringify({ type: 'skill_event', event });
    for (const c of allClients) {
      try { c.send(payload); } catch { /* ignore individual client errors */ }
    }
  });

  // Bloque 5: broadcast document lifecycle events.
  setDocumentEventListener((event) => {
    const payload = JSON.stringify({ type: 'document_event', event });
    // [DIAG temporal — confirmar broadcast]
    console.log(`[auto-offer] server broadcasting document_event to ${allClients.size} client(s); event.type=${event.type}`);
    for (const c of allClients) {
      try { c.send(payload); } catch { /* ignore */ }
    }
  });

  // Serial queue: only one in-flight request per server. The orchestrator
  // holds shared static state and we monkey-patch console during processing,
  // so concurrent requests would mix output streams.
  let busy = false;

  wss.on('connection', (ws) => {
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

      if (msg.type !== 'send') return;
      const text = String(msg.text ?? '').trim();
      const sessionId = String(msg.sessionId ?? 'default');
      if (!text) return;

      if (busy) {
        ws.send(JSON.stringify({ type: 'error', message: 'Shinobi está ocupado con otra petición — espera a que termine.' }));
        return;
      }
      busy = true;

      store.add(sessionId, 'user', text, null);
      ws.send(JSON.stringify({ type: 'thinking_start' }));

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
        const toolMatch = line.match(/\[🔨\]\s+Tool called:\s+(\S+)/);
        if (toolMatch) {
          try { ws.send(JSON.stringify({ type: 'tool_call', name: toolMatch[1] })); } catch {}
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
          // Slash commands NEVER reach the orchestrator from the web (FAIL 2 fix).
          // Any unrecognised slash gets a clear error in the agent bubble and a
          // log line in the thinking pane — but the LLM is never invoked.
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
        store.add(sessionId, 'agent', finalResponse, captured);
        try {
          ws.send(JSON.stringify({
            type: 'final',
            response: finalResponse,
            mode: (ShinobiOrchestrator as any).mode ?? 'kernel',
            model: ShinobiOrchestrator.getModel(),
          }));
        } catch {}

        // Bloque 5.3 — auto-offer hook. Punto único de convergencia: aquí
        // confluyen slash flow + LLM flow + cualquier futuro path. La
        // respuesta YA fue enviada al UI; ahora chequeamos si su contenido
        // tiene estructura y disparamos document_offer (toast).
        // [DIAG temporal — trazar cada gate para verificación.]
        const _respLen = finalResponse.length;
        const _heuristic = shouldOfferDocument(finalResponse);
        // alreadyGenerated: scan captured console lines for la traza que
        // el orchestrator emite cuando el LLM llama generate_document.
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
        store.add(sessionId, 'system', `[error] ${errMsg}`, captured);
        try { ws.send(JSON.stringify({ type: 'error', message: errMsg })); } catch {}
      } finally {
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        console.info = origInfo;
        busy = false;
      }
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

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[shinobi-web] Listening on http://localhost:${port}`);
      resolve({ url: `http://localhost:${port}` });
    });
  });
}
