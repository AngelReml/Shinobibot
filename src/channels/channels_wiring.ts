/**
 * Cableado del subsistema de canales (P2).
 *
 * El channelRegistry y los adapters estaban construidos pero ningún entry
 * point los registraba ni arrancaba (ghost feature). `startChannels()`
 * registra los adapters credential-free (Loopback siempre; Webhook si
 * SHINOBI_WEBHOOK_ENABLED=1), vincula el handler que enruta cada mensaje
 * entrante al orchestrator, y arranca el registry. Lo llama el web server.
 *
 * Los adapters de mensajería (Discord/Slack/WhatsApp/Signal/Matrix/Teams)
 * NO se registran aquí: requieren credenciales y se cablearán cuando el
 * operador las aporte.
 */

import { channelRegistry } from './channel_registry.js';
import { LoopbackAdapter } from './adapters/loopback_adapter.js';
import { WebhookAdapter } from './adapters/webhook_adapter.js';
import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';
import type { IncomingMessage, OutgoingMessage, MessageHandler } from './types.js';

let _started = false;

/** Handler único: enruta cada mensaje entrante de cualquier canal al orchestrator. */
async function orchestratorHandler(msg: IncomingMessage): Promise<OutgoingMessage | null> {
  const result: any = await ShinobiOrchestrator.process(`[CHANNEL: ${msg.channelId}] ${msg.text}`);
  const text = result?.response
    ? String(result.response)
    : result?.output ? String(result.output) : '(sin respuesta)';
  return { text };
}

/**
 * Arranca el subsistema de canales. Idempotente. `opts.handler` permite
 * inyectar un handler (tests); por defecto enruta al orchestrator.
 */
export async function startChannels(opts: { handler?: MessageHandler } = {}): Promise<{ started: string[]; skipped: string[]; errors: Array<{ id: string; error: string }> }> {
  const reg = channelRegistry();
  if (_started) return { started: [], skipped: [], errors: [] };
  if (!reg.get('loopback')) reg.register(new LoopbackAdapter());
  if (!reg.get('webhook')) reg.register(new WebhookAdapter());
  reg.bindHandler(opts.handler ?? orchestratorHandler);
  const r = await reg.start();
  _started = true;
  return r;
}

/** Test helper: reinicia la marca de arranque. */
export function _resetChannelsWiring(): void { _started = false; }
