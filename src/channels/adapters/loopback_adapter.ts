/**
 * Loopback Adapter — canal sintético en memoria para tests E2E.
 *
 * Permite simular el ciclo completo (incoming → handler → outgoing) sin
 * red ni credenciales. La prueba funcional del Sprint 1.3 lo usa para
 * demostrar la arquitectura de canales antes de que el usuario añada
 * tokens reales de Discord/Slack/Email.
 *
 * Uso típico en tests:
 *
 *   const adapter = new LoopbackAdapter();
 *   channelRegistry().register(adapter);
 *   channelRegistry().bindHandler(myHandler);
 *   await channelRegistry().start();
 *   const reply = await adapter.simulateIncoming({ text: 'hola', userId: 'u1' });
 */

import type { ChannelAdapter, IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget } from '../types.js';

export interface LoopbackOptions {
  /** Si true, isConfigured() devuelve false aunque esté instanciado.
   *  Útil para tests del registry que excluyen este adaptador. */
  inactive?: boolean;
}

export class LoopbackAdapter implements ChannelAdapter {
  readonly id = 'loopback' as const;
  readonly label = 'Loopback (in-memory)';

  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private readonly outbox: Array<{ target: ChannelTarget; msg: OutgoingMessage }> = [];
  private readonly cfg: LoopbackOptions;

  constructor(cfg: LoopbackOptions = {}) {
    this.cfg = cfg;
  }

  isConfigured(): boolean {
    return !this.cfg.inactive;
  }

  requiredEnvVars(): string[] {
    return []; // ninguno
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.running = true;
  }

  async stop(): Promise<void> {
    this.handler = null;
    this.running = false;
  }

  status(): { running: boolean; receivedCount: number; sentCount: number; lastError?: string } {
    return {
      running: this.running,
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
      lastError: this.lastError,
    };
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    this.outbox.push({ target, msg });
    this.sentCount++;
  }

  /** Para tests: simula un mensaje entrante y devuelve la respuesta. */
  async simulateIncoming(input: { text: string; userId?: string; conversationId?: string }): Promise<OutgoingMessage | null> {
    if (!this.handler || !this.running) {
      throw new Error('LoopbackAdapter.simulateIncoming antes de start()');
    }
    const incoming: IncomingMessage = {
      channelId: this.id,
      text: input.text,
      target: {
        channelId: this.id,
        conversationId: input.conversationId ?? 'default',
        userId: input.userId,
      },
      receivedAt: new Date().toISOString(),
    };
    this.receivedCount++;
    try {
      const reply = await this.handler(incoming);
      if (reply) await this.send(incoming.target, reply);
      return reply;
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
      throw e;
    }
  }

  /** Para tests: lee el outbox sin consumirlo. */
  peekOutbox(): Array<{ target: ChannelTarget; msg: OutgoingMessage }> {
    return [...this.outbox];
  }

  /** Para tests: vacía el outbox y devuelve copia. */
  drainOutbox(): Array<{ target: ChannelTarget; msg: OutgoingMessage }> {
    const out = [...this.outbox];
    this.outbox.length = 0;
    return out;
  }
}
