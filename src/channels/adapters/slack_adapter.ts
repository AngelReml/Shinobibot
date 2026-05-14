/**
 * Slack Adapter — conecta Shinobi a Slack via Socket Mode + Web API.
 *
 * Requisitos del operador (alta humana):
 *   - SLACK_BOT_TOKEN  (xoxb-...): token bot generado en api.slack.com
 *   - SLACK_APP_TOKEN  (xapp-...): token de socket mode
 *   - Scopes mínimos del bot: chat:write, channels:history, app_mentions:read,
 *     im:history, im:read, im:write
 *   - Habilitar Socket Mode + suscribir a `message.channels`, `message.im`,
 *     `app_mention` events
 *
 * Usamos `@slack/bolt` (que ya envuelve socket mode + web api). Si no
 * está instalado, fail-fast con instrucción de npm install.
 */

import type { ChannelAdapter, IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget } from '../types.js';

export class SlackAdapter implements ChannelAdapter {
  readonly id = 'slack' as const;
  readonly label = 'Slack';

  private app: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;

  isConfigured(): boolean {
    return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN);
  }

  requiredEnvVars(): string[] {
    return ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
  }

  status() {
    return { running: this.running, receivedCount: this.receivedCount, sentCount: this.sentCount, lastError: this.lastError };
  }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) throw new Error('SLACK_BOT_TOKEN o SLACK_APP_TOKEN no configurados');
    let bolt: any;
    // Import indirecto: la dep es opcional. Variable evita TS2307 cuando
    // @slack/bolt no está instalado en este host.
    const pkg = '@slack/bolt';
    try {
      bolt = await import(pkg);
    } catch {
      throw new Error('@slack/bolt no está instalado. Ejecuta: npm install @slack/bolt');
    }
    const { App } = bolt;
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
    });
    this.handler = handler;

    // Mensajes en canales donde el bot está + DMs.
    this.app.message(async ({ message, say }: any) => {
      try {
        if (message?.subtype || message?.bot_id) return; // ignorar eventos no humanos
        const incoming: IncomingMessage = {
          channelId: this.id,
          text: message?.text ?? '',
          target: {
            channelId: this.id,
            conversationId: message?.channel,
            userId: message?.user,
            metadata: { ts: message?.ts, teamId: message?.team },
          },
          receivedAt: new Date().toISOString(),
        };
        this.receivedCount++;
        const reply = await this.handler!(incoming);
        if (reply) {
          await say({ text: reply.text });
          this.sentCount++;
        }
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });

    // Menciones explícitas (@bot ...).
    this.app.event('app_mention', async ({ event, say }: any) => {
      try {
        const incoming: IncomingMessage = {
          channelId: this.id,
          text: event.text ?? '',
          target: {
            channelId: this.id,
            conversationId: event.channel,
            userId: event.user,
            metadata: { ts: event.ts, mention: true },
          },
          receivedAt: new Date().toISOString(),
        };
        this.receivedCount++;
        const reply = await this.handler!(incoming);
        if (reply) {
          await say({ text: reply.text });
          this.sentCount++;
        }
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });

    await this.app.start();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.app) {
      try { await this.app.stop(); } catch { /* swallow */ }
    }
    this.app = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    if (!this.app) throw new Error('Slack adapter no está running');
    await this.app.client.chat.postMessage({
      channel: target.conversationId,
      text: msg.text,
      thread_ts: (target.metadata as any)?.ts,
    });
    this.sentCount++;
  }
}
