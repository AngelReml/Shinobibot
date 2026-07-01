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
import { runExclusive } from '../coordinator/orchestrator_mutex.js';
import { setApprovalPreGate } from '../security/approval.js';
import type { ChatStore } from '../web/chat_store.js';
import { resolveUser, familyApprovalGate } from '../multiuser/multiuser_wiring.js';

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
    // G3 — modo familia: el canal WebSocket monta este mismo gate (server.ts).
    // Sin esto, un usuario `family` con noShell/noDestructive vía HTTP API no
    // tenía NINGUNA restricción (CRIT-04).
    const fGate = user.role === 'family' ? familyApprovalGate(user.userId) : null;

    try {
      opts.chatStore.add(sessionId, 'user', text, null);
      // Origin tag — el LLM lo lee como parte del input y sabe el contexto.
      const taggedInput = `[ORIGIN: ${originLabel} USER: ${user.userId} (${user.role})] ${text}`;
      // Mutex global del orchestrator: serializa esta petición con WebChat y
      // los demás canales (mismo runExclusive que server.ts), e instala el
      // pre-gate de familia SOLO dentro de la sección exclusiva — sin esto,
      // _preGate es estado global compartido y dos requests concurrentes de
      // canales distintos pueden pisarse el gate (CRIT-05).
      const result: any = await runExclusive(async () => {
        if (fGate) setApprovalPreGate(fGate);
        try {
          // CRIT-12/ALTA-20: bóveda de memoria del usuario resuelto, no la del owner.
          return await ShinobiOrchestrator.process(taggedInput, { userId: user.userId });
        } finally {
          if (fGate) setApprovalPreGate(null);
        }
      });
      const response = result?.response
        ? String(result.response)
        : (result?.output ? String(result.output) : JSON.stringify(result));
      opts.chatStore.add(sessionId, 'agent', response, null);
      res.json({
        response,
        mode: 'local',
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
