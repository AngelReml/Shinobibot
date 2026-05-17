/**
 * Webhook Adapter — receptor HTTP genérico para integraciones custom
 * (n8n, Zapier, sistemas internos, IFTTT, GitHub Actions, etc.).
 *
 * Expone un endpoint `POST /webhook/incoming` que acepta:
 *   { text: string, userId?: string, conversationId?: string,
 *     metadata?: object }
 *
 * Y devuelve sincronamente la respuesta del handler como JSON:
 *   { text: string, metadata?: object } | { error: string }
 *
 * Variables:
 *   - WEBHOOK_LISTEN_PORT (default 3334)
 *   - WEBHOOK_SHARED_SECRET (opcional, requerido en `Authorization: Bearer`)
 *
 * Diseñado para que el operador conecte cualquier sistema HTTP con
 * minimal setup.
 */

import { createServer, type IncomingMessage as HttpReq, type ServerResponse, type Server } from 'http';
import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';

export class WebhookAdapter implements ChannelAdapter {
  readonly id = 'webhook' as const;
  readonly label = 'Webhook genérico';

  private server: Server | null = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private port = 3334;

  isConfigured(): boolean {
    return process.env.SHINOBI_WEBHOOK_ENABLED === '1';
  }

  requiredEnvVars(): string[] {
    return ['SHINOBI_WEBHOOK_ENABLED'];
  }

  status() {
    return {
      running: this.running,
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
      lastError: this.lastError,
    };
  }

  /** Inyectable para tests. */
  getPort(): number { return this.port; }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) throw new Error('SHINOBI_WEBHOOK_ENABLED no es 1');
    this.handler = handler;
    this.port = parseInt(process.env.WEBHOOK_LISTEN_PORT ?? '3334', 10);

    this.server = createServer((req, res) => this.onRequest(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.running = true;
  }

  private async onRequest(req: HttpReq, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/webhook/incoming') {
      res.statusCode = 404;
      res.end('not_found');
      return;
    }
    const secret = process.env.WEBHOOK_SHARED_SECRET;
    if (secret) {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${secret}`) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    let body = '';
    for await (const chunk of req) body += chunk.toString('utf-8');
    let payload: any;
    try { payload = JSON.parse(body); }
    catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    if (typeof payload?.text !== 'string') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'text_required' }));
      return;
    }

    const incoming: IncomingMessage = {
      channelId: this.id,
      text: payload.text,
      target: {
        channelId: this.id,
        conversationId: payload.conversationId ?? 'webhook-default',
        userId: payload.userId,
        metadata: payload.metadata,
      },
      receivedAt: new Date().toISOString(),
    };
    this.receivedCount++;

    try {
      const reply = await this.handler!(incoming);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      if (reply) {
        this.sentCount++;
        res.end(JSON.stringify({ text: reply.text, metadata: reply.metadata }));
      } else {
        res.end(JSON.stringify({ text: null }));
      }
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: this.lastError }));
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.server = null;
    this.handler = null;
    this.running = false;
  }

  async send(_target: ChannelTarget, _msg: OutgoingMessage): Promise<void> {
    // Webhook es request/response síncrono: la respuesta se devuelve dentro
    // del onRequest, no hay envío proactivo (eso lo cubre el n8n bridge).
    // NO se lanza: un adapter registrado no debe romper channelRegistry.send().
    console.warn('[webhook] send() proactivo no soportado (canal síncrono) — usa el HTTP response del request original.');
  }
}
