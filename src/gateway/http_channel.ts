// src/gateway/http_channel.ts
//
// Bloque 6 — Express router para el gateway externo.
//
// Endpoints (todos bajo el token middleware):
//   POST /api/chat        { text, sessionId? }  → { response, mode, model, sessionId }
//   GET  /api/history?session=X                  → { messages: [...] }
//   GET  /api/info                               → { ok, version, channels, lan }
//
// La llamada es SÍNCRONA en v1 (caller espera ~5-30s típico). Si quieres
// streaming, v1.1 abrirá un endpoint SSE separado.

import { Router } from 'express';
import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import type { ChatStore } from '../web/chat_store.js';
import { resolveUser } from '../multiuser/multiuser_wiring.js';

export interface HttpChannelOptions {
  chatStore: ChatStore;
  /** Default session id when caller doesn't provide one. */
  defaultSessionId?: string;
  /** Origin tag prepended to every input (e.g., "http-api"). */
  originLabel?: string;
  /** Channel summary for /api/info. */
  channelInfo?: () => Record<string, any>;
}

export function createHttpChannelRouter(opts: HttpChannelOptions): Router {
  const router = Router();
  const defaultSession = opts.defaultSessionId ?? 'http-default';
  const originLabel = opts.originLabel ?? 'http';

  router.post('/chat', async (req, res) => {
    const body = req.body ?? {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : defaultSession;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    // P2 — multiuser: resuelve el usuario de la petición (cabecera
    // X-Shinobi-User) contra el UserRegistry, alta on-first-contact.
    const userHeader = typeof req.headers['x-shinobi-user'] === 'string'
      ? (req.headers['x-shinobi-user'] as string) : undefined;
    const user = resolveUser(userHeader);

    try {
      opts.chatStore.add(sessionId, 'user', text, null);
      // Origin tag — el LLM lo lee como parte del input y sabe el contexto.
      const taggedInput = `[ORIGIN: ${originLabel} USER: ${user.userId} (${user.role})] ${text}`;
      const result: any = await ShinobiOrchestrator.process(taggedInput);
      const response = result?.response
        ? String(result.response)
        : (result?.output ? String(result.output) : JSON.stringify(result));
      opts.chatStore.add(sessionId, 'agent', response, null);
      res.json({
        response,
        mode: (ShinobiOrchestrator as any).mode ?? 'kernel',
        model: ShinobiOrchestrator.getModel(),
        sessionId,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      opts.chatStore.add(sessionId, 'system', `[error] ${msg}`, null);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/history', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : '';
    if (!session) {
      res.status(400).json({ error: 'session query param required' });
      return;
    }
    const rows = opts.chatStore.list(session, 200);
    res.json({
      messages: rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        ts: r.ts,
      })),
    });
  });

  router.get('/info', (_req, res) => {
    res.json({
      ok: true,
      gateway: 'shinobi-bloque6',
      defaultSession,
      originLabel,
      ...opts.channelInfo?.(),
    });
  });

  return router;
}
