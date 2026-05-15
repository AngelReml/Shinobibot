/**
 * Matrix Adapter — conecta a Matrix Synapse/Dendrite via matrix-bot-sdk.
 *
 * Requisitos del operador:
 *   - MATRIX_HOMESERVER_URL  (e.g. https://matrix.org)
 *   - MATRIX_ACCESS_TOKEN    (long-lived access token del bot)
 *   - MATRIX_BOT_USER_ID     (e.g. @shinobi:matrix.org)
 *   - MATRIX_ALLOWED_ROOMS   (opcional, csv de room IDs)
 *
 * Sin SSO/MFA — el operador genera el access token con Element o curl.
 */

import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';

export class MatrixAdapter implements ChannelAdapter {
  readonly id = 'matrix' as const;
  readonly label = 'Matrix';

  private client: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private allowedRooms: Set<string> | null = null;

  isConfigured(): boolean {
    return !!(process.env.MATRIX_HOMESERVER_URL && process.env.MATRIX_ACCESS_TOKEN
      && process.env.MATRIX_BOT_USER_ID);
  }

  requiredEnvVars(): string[] {
    return ['MATRIX_HOMESERVER_URL', 'MATRIX_ACCESS_TOKEN', 'MATRIX_BOT_USER_ID'];
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
    if (!this.isConfigured()) {
      throw new Error('MATRIX_* vars no configuradas');
    }
    let mxPkg: any;
    const pkg = 'matrix-bot-sdk';
    try {
      mxPkg = await import(pkg);
    } catch {
      throw new Error('matrix-bot-sdk no está instalado. Ejecuta: npm install matrix-bot-sdk');
    }
    const { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } = mxPkg;

    const allowedRaw = process.env.MATRIX_ALLOWED_ROOMS;
    if (allowedRaw) {
      this.allowedRooms = new Set(allowedRaw.split(',').map(s => s.trim()).filter(Boolean));
    }

    const storage = new SimpleFsStorageProvider('./.matrix_storage.json');
    this.client = new MatrixClient(
      process.env.MATRIX_HOMESERVER_URL!,
      process.env.MATRIX_ACCESS_TOKEN!,
      storage,
    );
    this.handler = handler;
    AutojoinRoomsMixin.setupOnClient(this.client);

    const botId = process.env.MATRIX_BOT_USER_ID!;
    this.client.on('room.message', async (roomId: string, event: any) => {
      try {
        if (!event?.content || event.sender === botId) return;
        if (this.allowedRooms && !this.allowedRooms.has(roomId)) return;
        if (event.content.msgtype !== 'm.text') return;

        const incoming: IncomingMessage = {
          channelId: this.id,
          text: event.content.body ?? '',
          target: {
            channelId: this.id,
            conversationId: roomId,
            userId: event.sender,
            metadata: { eventId: event.event_id },
          },
          receivedAt: new Date(event.origin_server_ts ?? Date.now()).toISOString(),
        };
        this.receivedCount++;
        const reply = await this.handler!(incoming);
        if (reply) {
          await this.client.sendMessage(roomId, { msgtype: 'm.text', body: reply.text });
          this.sentCount++;
        }
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });

    await this.client.start();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { this.client.stop(); } catch { /* swallow */ }
    }
    this.client = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    if (!this.client) throw new Error('Matrix adapter no está running');
    await this.client.sendMessage(target.conversationId, { msgtype: 'm.text', body: msg.text });
    this.sentCount++;
  }
}
