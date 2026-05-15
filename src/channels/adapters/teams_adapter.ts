/**
 * Microsoft Teams Adapter — usa la BotBuilder SDK + canal Teams.
 *
 * Requisitos del operador:
 *   - TEAMS_APP_ID         (Azure Bot registration App ID)
 *   - TEAMS_APP_PASSWORD   (client secret)
 *   - TEAMS_LISTEN_PORT    (default 3978)
 *
 * El bot se registra en Azure como BotFramework, y Teams habla con él
 * vía HTTPS. Este adapter expone un servidor HTTP en LISTEN_PORT que
 * recibe mensajes; el operador necesita ngrok/cloudflare-tunnel o el
 * modo VPS de Shinobi para exponerlo a internet.
 */

import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';

export class TeamsAdapter implements ChannelAdapter {
  readonly id = 'teams' as const;
  readonly label = 'Microsoft Teams';

  private adapter: any = null;
  private server: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;

  isConfigured(): boolean {
    return !!(process.env.TEAMS_APP_ID && process.env.TEAMS_APP_PASSWORD);
  }

  requiredEnvVars(): string[] {
    return ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD'];
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
    if (!this.isConfigured()) throw new Error('TEAMS_APP_ID o TEAMS_APP_PASSWORD no configurados');
    let bbPkg: any;
    const pkg = 'botbuilder';
    try {
      bbPkg = await import(pkg);
    } catch {
      throw new Error('botbuilder no está instalado. Ejecuta: npm install botbuilder');
    }
    const { BotFrameworkAdapter, MessageFactory } = bbPkg;

    this.adapter = new BotFrameworkAdapter({
      appId: process.env.TEAMS_APP_ID,
      appPassword: process.env.TEAMS_APP_PASSWORD,
    });
    this.adapter.onTurnError = async (_ctx: any, err: any) => {
      this.lastError = err?.message ?? String(err);
    };
    this.handler = handler;

    const http = await import('http');
    const port = parseInt(process.env.TEAMS_LISTEN_PORT ?? '3978', 10);

    this.server = http.createServer((req, res) => {
      if (req.url !== '/api/messages' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end();
        return;
      }
      this.adapter.processActivity(req, res, async (context: any) => {
        if (context.activity.type !== 'message') return;
        try {
          const incoming: IncomingMessage = {
            channelId: this.id,
            text: context.activity.text ?? '',
            target: {
              channelId: this.id,
              conversationId: context.activity.conversation.id,
              userId: context.activity.from.id,
              metadata: { tenantId: context.activity.channelData?.tenant?.id },
            },
            receivedAt: new Date().toISOString(),
          };
          this.receivedCount++;
          const reply = await this.handler!(incoming);
          if (reply) {
            await context.sendActivity(MessageFactory.text(reply.text));
            this.sentCount++;
          }
        } catch (e: any) {
          this.lastError = e?.message ?? String(e);
        }
      });
    });
    this.server.listen(port);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.server) {
      try { this.server.close(); } catch { /* swallow */ }
    }
    this.server = null;
    this.adapter = null;
    this.handler = null;
    this.running = false;
  }

  async send(_target: ChannelTarget, _msg: OutgoingMessage): Promise<void> {
    // Teams requiere context activity para enviar fuera de turn; las
    // notificaciones proactivas necesitan conversationReference cacheada.
    // Lo dejamos para una iteración futura.
    throw new Error('Teams proactive send requires cached conversation reference (no implementado en este sprint)');
  }
}
