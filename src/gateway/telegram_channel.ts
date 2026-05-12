// src/gateway/telegram_channel.ts
//
// Bloque 6 — conector Telegram usando grammY. Polling mode (no webhooks)
// para evitar requerir IP pública / certificado.
//
// Reglas:
//   - Mensajes de usuarios FUERA de la allowlist se ignoran silenciosamente
//     (con log) — no respondemos, para no exponer al bot a abuso.
//   - sessionId = `tg-<userId>` por usuario (cada Telegram user tiene su
//     historial separado en chat_store).
//   - Origin tag `[ORIGIN: telegram:<userId>]` prepended al texto antes de
//     pasarlo al orchestrator.
//   - Respuestas largas > 4096 chars se trocean (límite Telegram).

import { Bot, type BotConfig } from 'grammy';
import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import type { ChatStore } from '../web/chat_store.js';

export interface TelegramChannelOptions {
  botToken: string;
  allowedUserIds: number[];
  chatStore: ChatStore;
  /** Override session id strategy. Default `tg-<userId>`. */
  sessionIdFor?: (userId: number) => string;
  /** If true, do not actually start polling (used by tests). */
  dryRun?: boolean;
}

export interface TelegramChannelHandle {
  bot: Bot;
  username: string | null;
  stop: () => Promise<void>;
  /** Public for tests: process a synthetic message as if it came from Telegram. */
  handleMessage: (userId: number, text: string) => Promise<string>;
}

const TG_MSG_LIMIT = 4096;

function chunkForTelegram(text: string): string[] {
  if (text.length <= TG_MSG_LIMIT) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + TG_MSG_LIMIT));
    i += TG_MSG_LIMIT;
  }
  return out;
}

export async function startTelegramChannel(opts: TelegramChannelOptions): Promise<TelegramChannelHandle> {
  const allow = new Set(opts.allowedUserIds);
  const sessionIdFor = opts.sessionIdFor ?? ((id: number) => `tg-${id}`);
  const botCfg: BotConfig<any> = {};
  const bot = new Bot(opts.botToken, botCfg);

  // Core message processor — extracted so tests can call it without grammY.
  async function handleMessage(userId: number, text: string): Promise<string> {
    if (!allow.has(userId)) {
      console.log(`[telegram] ignoring message from user_id=${userId} (not in allowlist)`);
      return ''; // empty response = nothing sent back
    }
    const sessionId = sessionIdFor(userId);
    opts.chatStore.add(sessionId, 'user', text, null);
    const taggedInput = `[ORIGIN: telegram:${userId}] ${text}`;
    try {
      const result: any = await ShinobiOrchestrator.process(taggedInput);
      const response = result?.response
        ? String(result.response)
        : (result?.output ? String(result.output) : JSON.stringify(result));
      opts.chatStore.add(sessionId, 'agent', response, null);
      return response;
    } catch (e: any) {
      const errMsg = `[error] ${e?.message ?? e}`;
      opts.chatStore.add(sessionId, 'system', errMsg, null);
      return errMsg;
    }
  }

  bot.command('start', (ctx) => {
    const id = ctx.from?.id;
    if (id && !allow.has(id)) {
      console.log(`[telegram] /start from user_id=${id} (not in allowlist) — ignoring`);
      return;
    }
    ctx.reply('🥷 Shinobi conectado. Mándame un mensaje y respondo.');
  });

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.message?.text;
    if (!userId || !text) return;
    const reply = await handleMessage(userId, text);
    if (!reply) return; // ignored user
    for (const chunk of chunkForTelegram(reply)) {
      try { await ctx.reply(chunk); } catch (e: any) { console.log(`[telegram] reply failed: ${e?.message ?? e}`); }
    }
  });

  let username: string | null = null;
  if (!opts.dryRun) {
    // Fetch bot identity & start long-polling.
    try {
      const me = await bot.api.getMe();
      username = me.username || null;
    } catch (e: any) {
      console.log(`[telegram] getMe failed: ${e?.message ?? e}`);
    }
    // bot.start() returns a Promise that resolves when polling is stopped.
    // We deliberately don't await it; the polling runs in the background.
    void bot.start({ onStart: () => { /* started */ } }).catch(e => {
      console.log(`[telegram] polling crashed: ${e?.message ?? e}`);
    });
  }

  return {
    bot,
    username,
    stop: async () => {
      try { await bot.stop(); } catch { /* ignore */ }
    },
    handleMessage,
  };
}
