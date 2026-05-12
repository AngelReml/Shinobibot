// src/gateway/index.ts
//
// Bloque 6 — orchestrator de canales del gateway externo.
//
// startGateway(opts) levanta:
//   - Express server en {host}:{port} con token middleware en /api/*
//   - http_channel router (REST /api/chat, /api/history, /api/info)
//   - Telegram bot via grammY si opts.telegram presente
//
// Retorna `{stop}` para shutdown limpio.
//
// La WebChat remoto es el server del Bloque 1 (port 3333, ya bindea a
// 0.0.0.0); este módulo NO duplica HTML ni WS — solo lo enumera al boot.

import express from 'express';
import http from 'http';
import { authMiddleware } from './auth.js';
import { createHttpChannelRouter } from './http_channel.js';
import { startTelegramChannel, type TelegramChannelHandle } from './telegram_channel.js';
import { lanWebChatInfo, getLanAddresses } from './webchat_channel.js';
import type { ChatStore } from '../web/chat_store.js';

export interface GatewayOptions {
  port: number;
  host: string;
  token: string;
  chatStore: ChatStore;
  /** If undefined, Telegram channel is skipped. */
  telegram?: {
    botToken: string;
    allowedUserIds: number[];
  };
  /** Default sessionId for http callers that don't provide one. */
  defaultHttpSession?: string;
  /** Port of the Bloque 1 web server, used for LAN WebChat info. */
  webLocalPort?: number;
}

export interface GatewayHandle {
  httpServer: http.Server;
  telegram: TelegramChannelHandle | null;
  /** URL the gateway is listening on (e.g. http://0.0.0.0:3334). */
  url: string;
  stop: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // /api/* requires auth.
  app.use('/api', authMiddleware(opts.token));
  app.use('/api', createHttpChannelRouter({
    chatStore: opts.chatStore,
    defaultSessionId: opts.defaultHttpSession ?? 'http-default',
    originLabel: 'http',
    channelInfo: () => ({
      lan: getLanAddresses(),
      webLocalPort: opts.webLocalPort,
      telegramEnabled: !!opts.telegram,
    }),
  }));

  // Public landing — no auth, just shows the user the gateway is alive.
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      'Shinobi Gateway activo.\n' +
      'WebChat LAN: ' + (opts.webLocalPort ? lanWebChatInfo(opts.webLocalPort) : '(web local no expuesto)') + '\n' +
      'REST API: POST /api/chat (Authorization: Bearer <token>)\n'
    );
  });

  const httpServer = http.createServer(app);
  await new Promise<void>((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(opts.port, opts.host, () => res());
  });

  let telegram: TelegramChannelHandle | null = null;
  if (opts.telegram) {
    telegram = await startTelegramChannel({
      botToken: opts.telegram.botToken,
      allowedUserIds: opts.telegram.allowedUserIds,
      chatStore: opts.chatStore,
    });
  }

  const url = `http://${opts.host}:${opts.port}`;
  return {
    httpServer,
    telegram,
    url,
    stop: async () => {
      try { await new Promise<void>((res) => httpServer.close(() => res())); } catch { /* ignore */ }
      if (telegram) { try { await telegram.stop(); } catch { /* ignore */ } }
    },
  };
}

/**
 * Parse SHINOBI_TELEGRAM_ALLOWED_USER_IDS from env. Accepts "123,456,789".
 * Returns empty array on missing or malformed input.
 */
export function parseAllowedUserIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s))
    .map(s => parseInt(s, 10));
}
