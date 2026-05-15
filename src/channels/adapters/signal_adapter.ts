/**
 * Signal Adapter — usa `signal-cli` (https://github.com/AsamK/signal-cli)
 * como binario externo + JSON-RPC daemon mode.
 *
 * Requisitos del operador:
 *   - signal-cli instalado y registrado contra un número de teléfono.
 *   - SIGNAL_PHONE_NUMBER: +34123456789
 *   - SIGNAL_CLI_BIN (opcional, default `signal-cli`).
 *   - SIGNAL_ALLOWED_NUMBERS (opcional, csv): whitelist.
 *
 * En este adapter NO embebemos signal-cli; spawneamos `signal-cli --daemon`
 * y leemos JSON-RPC sobre stdio. El operador debe registrar el número
 * fuera de Shinobi (no automatizamos verificación SMS).
 */

import { spawn, type ChildProcess } from 'child_process';
import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';

export class SignalAdapter implements ChannelAdapter {
  readonly id = 'signal' as const;
  readonly label = 'Signal';

  private proc: ChildProcess | null = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private allowedNumbers: Set<string> | null = null;
  private requestId = 0;

  isConfigured(): boolean {
    return !!process.env.SIGNAL_PHONE_NUMBER;
  }

  requiredEnvVars(): string[] {
    return ['SIGNAL_PHONE_NUMBER'];
  }

  status() {
    return {
      running: this.running,
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
      lastError: this.lastError,
    };
  }

  /**
   * Permite inyectar un proc child custom (para tests). El default es
   * spawn real de signal-cli.
   */
  protected spawnDaemon(): ChildProcess {
    const bin = process.env.SIGNAL_CLI_BIN ?? 'signal-cli';
    const phone = process.env.SIGNAL_PHONE_NUMBER!;
    return spawn(bin, ['-u', phone, 'jsonRpc'], { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('SIGNAL_PHONE_NUMBER no configurado');
    }
    const allowedRaw = process.env.SIGNAL_ALLOWED_NUMBERS;
    if (allowedRaw) {
      this.allowedNumbers = new Set(allowedRaw.split(',').map(s => s.trim()).filter(Boolean));
    }

    this.handler = handler;
    this.proc = this.spawnDaemon();
    if (!this.proc.stdout) throw new Error('signal-cli stdout no disponible');

    let buf = '';
    this.proc.stdout.on('data', async (chunk) => {
      buf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        await this.handleLine(line);
      }
    });
    this.proc.stderr?.on('data', (chunk) => {
      this.lastError = chunk.toString('utf-8').slice(0, 200);
    });
    this.proc.on('exit', () => {
      this.running = false;
    });
    this.running = true;
  }

  private async handleLine(line: string): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method !== 'receive') return;
    const env = msg.params?.envelope;
    if (!env || !env.dataMessage) return;
    const from = env.source ?? env.sourceNumber;
    if (this.allowedNumbers && !this.allowedNumbers.has(from)) return;
    const incoming: IncomingMessage = {
      channelId: this.id,
      text: env.dataMessage.message ?? '',
      target: {
        channelId: this.id,
        conversationId: env.dataMessage.groupInfo?.groupId ?? from,
        userId: from,
        metadata: { timestamp: env.timestamp },
      },
      receivedAt: new Date(env.timestamp ?? Date.now()).toISOString(),
    };
    this.receivedCount++;
    try {
      const reply = await this.handler!(incoming);
      if (reply) {
        await this.send(incoming.target, reply);
      }
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
    }
  }

  async stop(): Promise<void> {
    if (this.proc) {
      try { this.proc.kill('SIGTERM'); } catch { /* swallow */ }
    }
    this.proc = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    if (!this.proc || !this.proc.stdin) throw new Error('Signal adapter no está running');
    const id = ++this.requestId;
    const payload = {
      jsonrpc: '2.0',
      id,
      method: 'send',
      params: { recipient: [target.conversationId], message: msg.text },
    };
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
    this.sentCount++;
  }
}
