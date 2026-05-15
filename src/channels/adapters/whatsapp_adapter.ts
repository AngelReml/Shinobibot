/**
 * WhatsApp Adapter — usa `whatsapp-web.js` (Web client unofficial).
 *
 * Requisitos del operador:
 *   - WHATSAPP_SESSION_PATH (opcional, default `./.wa_session`): donde se
 *     persiste la sesión de la cuenta tras el QR inicial.
 *   - WHATSAPP_ALLOWED_CHATS (opcional, csv): si está, solo procesa
 *     mensajes de esos chat IDs (whitelist anti-spam).
 *
 * El primer arranque imprime un QR en consola que el operador escanea
 * con WhatsApp móvil. Tras eso, la sesión persiste.
 *
 * Dynamic import indirecto: `whatsapp-web.js` no es dep base.
 */

import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';

export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = 'whatsapp' as const;
  readonly label = 'WhatsApp';

  private client: any = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private allowedChats: Set<string> | null = null;

  isConfigured(): boolean {
    // WhatsApp Web no requiere token; basta con habilitar el flag.
    return process.env.SHINOBI_WHATSAPP_ENABLED === '1';
  }

  requiredEnvVars(): string[] {
    return ['SHINOBI_WHATSAPP_ENABLED'];
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
      throw new Error('SHINOBI_WHATSAPP_ENABLED no es 1');
    }
    let waPkg: any;
    const pkg = 'whatsapp-web.js';
    try {
      waPkg = await import(pkg);
    } catch {
      throw new Error('whatsapp-web.js no está instalado. Ejecuta: npm install whatsapp-web.js');
    }
    const { Client, LocalAuth } = waPkg;

    const allowedRaw = process.env.WHATSAPP_ALLOWED_CHATS;
    if (allowedRaw) {
      this.allowedChats = new Set(allowedRaw.split(',').map(s => s.trim()).filter(Boolean));
    }

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: process.env.WHATSAPP_SESSION_PATH ?? './.wa_session',
      }),
    });
    this.handler = handler;

    this.client.on('qr', (qr: string) => {
      // En el primer arranque el operador debe escanear este QR.
      console.log('[WhatsApp] Escanea este QR con WhatsApp móvil:');
      console.log(qr);
    });

    this.client.on('message', async (msg: any) => {
      try {
        if (msg.fromMe) return;
        if (this.allowedChats && !this.allowedChats.has(msg.from)) return;
        const incoming: IncomingMessage = {
          channelId: this.id,
          text: msg.body ?? '',
          target: {
            channelId: this.id,
            conversationId: msg.from,
            userId: msg.author ?? msg.from,
            metadata: { wamId: msg.id?._serialized },
          },
          receivedAt: new Date().toISOString(),
        };
        this.receivedCount++;
        const reply = await this.handler!(incoming);
        if (reply) {
          await msg.reply(reply.text);
          this.sentCount++;
        }
      } catch (e: any) {
        this.lastError = e?.message ?? String(e);
      }
    });

    await this.client.initialize();
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
    if (!this.client) throw new Error('WhatsApp adapter no está running');
    await this.client.sendMessage(target.conversationId, msg.text);
    this.sentCount++;
  }
}
