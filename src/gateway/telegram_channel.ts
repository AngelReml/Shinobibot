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
import { runExclusive } from '../coordinator/orchestrator_mutex.js';
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

  const MODEL_LIST = [
    'anthropic/claude-haiku-4-5      — rápido, barato (default)',
    'anthropic/claude-sonnet-4-6     — equilibrado',
    'anthropic/claude-opus-4-8       — máxima capacidad',
    'openai/gpt-4o-mini              — muy barato',
    'openai/gpt-4o                   — GPT tope',
    'google/gemini-2.0-flash         — Gemini rápido',
    'meta-llama/llama-3.3-70b-versatile — open source',
    'z-ai/glm-4.7                    — gratuito en OR',
    'deepseek/deepseek-chat          — razonamiento barato',
  ];

  // Handles /model commands locally without invoking the orchestrator.
  function handleModelCommand(text: string): string | null {
    const trimmed = text.trim();
    if (!/^\/model(\s|$)/i.test(trimmed)) return null;
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return `Modelo activo: ${ShinobiOrchestrator.getModel()}`;
    }
    const sub = parts[1].toLowerCase();
    if (sub === 'list') {
      return 'Modelos disponibles en OpenRouter:\n' + MODEL_LIST.join('\n') +
        '\n\nUso: /model <id>  |  /model auto';
    }
    if (sub === 'auto') {
      ShinobiOrchestrator.setModel(undefined);
      return 'Modelo: auto (usa el default del orchestrator)';
    }
    ShinobiOrchestrator.setModel(parts[1]);
    return `Modelo cambiado a: ${parts[1]}`;
  }

  // Core message processor — extracted so tests can call it without grammY.
  async function handleMessage(userId: number, text: string): Promise<string> {
    if (!allow.has(userId)) {
      console.log(`[telegram] ignoring message from user_id=${userId} (not in allowlist)`);
      return ''; // empty response = nothing sent back
    }
    // /model command handled locally — never reaches the orchestrator.
    const modelReply = handleModelCommand(text);
    if (modelReply !== null) return modelReply;

    const sessionId = sessionIdFor(userId);
    opts.chatStore.add(sessionId, 'user', text, null);
    const taggedInput = `[ORIGIN: telegram:${userId}] ${text}`;
    try {
      // Mutex global del orchestrator (mismo runExclusive que WebChat y la
      // API HTTP): sin esto, un mensaje de Telegram podía correr en paralelo
      // con una sesión WebSocket que tiene `_preGate` de familia instalado,
      // pisándolo o quedando sin serializar el estado estático del
      // orchestrator (CRIT-05).
      const result: any = await runExclusive(async () => ShinobiOrchestrator.process(taggedInput));
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
