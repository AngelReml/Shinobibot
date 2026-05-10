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
import Database from 'better-sqlite3';

import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import { handleSlashCommand } from '../coordinator/slash_commands.js';
import { ResidentLoop } from '../runtime/resident_loop.js';
import { KernelClient } from '../bridge/kernel_client.js';
import { setSkillEventListener } from '../skills/skill_manager.js';
import { setDocumentEventListener } from '../documents/factory.js';
import {
  ensureApprovalModeInitialized,
  setApprovalAsker,
  getApprovalMode,
  type Approval,
} from '../security/approval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChatRow {
  id: string;
  session_id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  thinking_json: string | null;
  ts: string;
}

class ChatStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        thinking_json TEXT,
        ts TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_ts ON web_chat_messages(session_id, ts);
    `);
  }
  add(sessionId: string, role: 'user' | 'agent' | 'system', content: string, thinking: string[] | null): ChatRow {
    const row: ChatRow = {
      id: randomUUID(),
      session_id: sessionId,
      role,
      content,
      thinking_json: thinking && thinking.length ? JSON.stringify(thinking) : null,
      ts: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO web_chat_messages (id, session_id, role, content, thinking_json, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.session_id, row.role, row.content, row.thinking_json, row.ts);
    return row;
  }
  list(sessionId: string, limit: number = 200): ChatRow[] {
    return this.db.prepare(
      'SELECT * FROM web_chat_messages WHERE session_id = ? ORDER BY ts ASC LIMIT ?'
    ).all(sessionId, limit) as ChatRow[];
  }
}

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
  app.use(express.static(path.join(__dirname, 'public')));

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
