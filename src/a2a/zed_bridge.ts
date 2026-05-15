/**
 * Zed Bridge — adaptador específico para conectar Shinobi a la IDE
 * Zed (https://zed.dev) vía Agent Client Protocol (ACP) sobre stdio.
 *
 * Zed habla ACP por stdin/stdout siguiendo la spec JSON-RPC 2.0. Este
 * módulo construye sobre `acp_adapter.ts` (Sprint P1.4) añadiendo:
 *
 *   - `ZedBridge.serveStdio(dispatcher)` lee líneas de stdin, procesa
 *     cada una como ACP request, escribe la response a stdout.
 *   - Manejo de `initialize` con devolución de capabilities específicas
 *     para IDE: file_attach, prompt_with_context, cancel, follow.
 *   - Logging a stderr (NUNCA a stdout, donde van responses JSON-RPC).
 *
 * Uso real (no en este sprint, requiere integración con runtime):
 *   bin/shinobi-acp.js → arranca ZedBridge.serveStdio(dispatcher)
 *   Zed config: { command: 'shinobi-acp', args: [], capabilities: ... }
 */

import { createInterface, type Interface } from 'readline';
import {
  parseAcpRequest, acpRequestToEnvelope, envelopeResponseToAcp,
} from './acp_adapter.js';
import type { A2ADispatcher } from './protocol.js';

export interface ZedBridgeOptions {
  selfId?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface ZedCapabilities {
  /** Soporta attach de archivos al prompt. */
  fileAttachments: boolean;
  /** Soporta cancel de prompt en curso. */
  cancellation: boolean;
  /** Soporta tool calls visibles para el editor. */
  toolVisibility: boolean;
  /** Soporta streaming de la respuesta. */
  streaming: boolean;
}

export const SHINOBI_ZED_CAPS: ZedCapabilities = {
  fileAttachments: true,
  cancellation: true,
  toolVisibility: true,
  streaming: false, // SSE viene en una iteración futura.
};

export class ZedBridge {
  private rl: Interface | null = null;
  private dispatcher: A2ADispatcher | null = null;
  private stopped = false;

  constructor(public readonly opts: ZedBridgeOptions = {}) {}

  /**
   * Conecta el bridge a stdin/stdout. Procesa cada línea como
   * JSON-RPC ACP. Termina cuando stdin cierra o llaman a stop().
   */
  async serveStdio(dispatcher: A2ADispatcher): Promise<void> {
    this.dispatcher = dispatcher;
    const inStream = this.opts.stdin ?? process.stdin;
    const outStream = this.opts.stdout ?? process.stdout;
    const errStream = this.opts.stderr ?? process.stderr;

    this.rl = createInterface({ input: inStream, terminal: false });

    errStream.write(`[zed-bridge] listening on stdio (selfId=${this.opts.selfId ?? 'shinobi'})\n`);

    const pending: Set<Promise<void>> = new Set();
    return new Promise<void>((resolve) => {
      this.rl!.on('line', (line) => {
        if (this.stopped) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        const task = (async () => {
          try {
            const response = await this.handleLine(trimmed);
            if (response) {
              outStream.write(JSON.stringify(response) + '\n');
            }
          } catch (e: any) {
            errStream.write(`[zed-bridge] error: ${e?.message ?? e}\n`);
          }
        })();
        pending.add(task);
        task.finally(() => pending.delete(task));
      });
      this.rl!.on('close', async () => {
        errStream.write('[zed-bridge] stdin closed, draining pending tasks\n');
        await Promise.allSettled([...pending]);
        resolve();
      });
    });
  }

  /** Procesa una línea ACP y devuelve la response a escribir. */
  async handleLine(line: string): Promise<object | null> {
    let raw: any;
    try { raw = JSON.parse(line); } catch {
      return {
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Parse error' },
      };
    }
    const req = parseAcpRequest(raw);
    if (!req) {
      return {
        jsonrpc: '2.0', id: raw?.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }
    // Caso especial: initialize devuelve nuestras capabilities.
    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0', id: req.id,
        result: {
          protocolVersion: 'acp/1',
          agent: this.opts.selfId ?? 'shinobi',
          capabilities: SHINOBI_ZED_CAPS,
        },
      };
    }
    if (!this.dispatcher) {
      return {
        jsonrpc: '2.0', id: req.id,
        error: { code: -32000, message: 'no_dispatcher' },
      };
    }
    const env = acpRequestToEnvelope(req, { selfId: this.opts.selfId ?? 'shinobi', from: 'zed' });
    if (!env) {
      return {
        jsonrpc: '2.0', id: req.id,
        error: { code: -32601, message: `unsupported_acp_method:${req.method}` },
      };
    }
    const resp = await this.dispatcher.dispatch(env);
    return envelopeResponseToAcp(req.id, resp);
  }

  stop(): void {
    this.stopped = true;
    if (this.rl) this.rl.close();
  }
}
