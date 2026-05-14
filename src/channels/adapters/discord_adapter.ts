/**
 * Discord Adapter — conecta Shinobi a un bot de Discord via discord.js.
 *
 * Requisitos del operador (no autocreables):
 *   - DISCORD_BOT_TOKEN: token del bot creado en
 *     https://discord.com/developers/applications
 *   - Opcional DISCORD_ALLOWED_GUILDS: CSV de guild ids permitidos.
 *     Si está vacío, acepta cualquier guild donde el bot esté.
 *   - Permisos del bot: Read Messages, Send Messages, Read Message
 *     History en los canales relevantes.
 *
 * El paquete `discord.js` no se incluye como dependencia obligatoria
 * (~5MB). Se importa dinámicamente en `start()`. Si no está instalado,
 * el adaptador falla con un mensaje claro pidiendo
 * `npm install discord.js`.
 */

import type { ChannelAdapter, IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget } from '../types.js';

export class DiscordAdapter implements ChannelAdapter {
  readonly id = 'discord' as const;
  readonly label = 'Discord';

  private client: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;

  isConfigured(): boolean {
    return !!process.env.DISCORD_BOT_TOKEN;
  }

  requiredEnvVars(): string[] {
    return ['DISCORD_BOT_TOKEN'];
  }

  status() {
    return {
      running: this.running,
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
      lastError: this.lastError,
    };
  }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) throw new Error('DISCORD_BOT_TOKEN no está configurado');
    let discordjs: any;
    // Import indirecto: el dep es opcional y solo se carga cuando el
    // operador activa el canal. Variable intermedia evita que tsc
    // resuelva el módulo en compile time (fallaría TS2307 si no está).
    const pkg = 'discord.js';
    try {
      discordjs = await import(pkg);
    } catch {
      throw new Error('discord.js no está instalado. Ejecuta: npm install discord.js');
    }
    const { Client, GatewayIntentBits, Partials } = discordjs;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
    this.handler = handler;

    const allowedGuilds = (process.env.DISCORD_ALLOWED_GUILDS || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    this.client.on('messageCreate', async (m: any) => {
      try {
        if (m.author?.bot) return; // ignora mensajes de otros bots
        if (allowedGuilds.length > 0 && m.guildId && !allowedGuilds.includes(m.guildId)) return;
        const incoming: IncomingMessage = {
          channelId: this.id,
          text: m.content ?? '',
          target: {
            channelId: this.id,
            conversationId: m.channelId,
            userId: m.author?.id,
            metadata: { guildId: m.guildId, replyToMessageId: m.id },
          },
          attachments: m.attachments?.map((a: any) => ({ url: a.url, mimeType: a.contentType, name: a.name })) ?? [],
          receivedAt: new Date().toISOString(),
        };
        this.receivedCount++;
        const reply = await this.handler!(incoming);
        if (reply) await this.send(incoming.target, reply);
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });

    await this.client.login(process.env.DISCORD_BOT_TOKEN);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.destroy(); } catch { /* swallow */ }
    }
    this.client = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    if (!this.client) throw new Error('Discord adapter no está running');
    const channel = await this.client.channels.fetch(target.conversationId);
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`channel ${target.conversationId} no es enviable`);
    }
    await channel.send({ content: msg.text });
    this.sentCount++;
  }
}
