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
/**
 * Adapters de mensajería que requieren credenciales. Se registran (import
 * dinámico, tolerante a que falte la dependencia npm), pero `start()` solo
 * los arranca si su `isConfigured()` es true — es decir, cuando el operador
 * ha aportado los tokens. Sin tokens quedan registrados pero NO arrancados.
 */
const CREDENTIAL_ADAPTERS: Array<{ id: string; load: () => Promise<any>; cls: string }> = [
  { id: 'discord',  load: () => import('./adapters/discord_adapter.js'),  cls: 'DiscordAdapter' },
  { id: 'slack',    load: () => import('./adapters/slack_adapter.js'),    cls: 'SlackAdapter' },
  { id: 'whatsapp', load: () => import('./adapters/whatsapp_adapter.js'), cls: 'WhatsAppAdapter' },
  { id: 'signal',   load: () => import('./adapters/signal_adapter.js'),   cls: 'SignalAdapter' },
  { id: 'matrix',   load: () => import('./adapters/matrix_adapter.js'),   cls: 'MatrixAdapter' },
  { id: 'teams',    load: () => import('./adapters/teams_adapter.js'),    cls: 'TeamsAdapter' },
  { id: 'email',    load: () => import('./adapters/email_adapter.js'),    cls: 'EmailAdapter' },
];

export async function startChannels(opts: { handler?: MessageHandler } = {}): Promise<{ started: string[]; skipped: string[]; errors: Array<{ id: string; error: string }> }> {
  const reg = channelRegistry();
  if (_started) return { started: [], skipped: [], errors: [] };
  if (!reg.get('loopback')) reg.register(new LoopbackAdapter());
  if (!reg.get('webhook')) reg.register(new WebhookAdapter());

  // Adapters de mensajería con credenciales: registro tolerante. Si la
  // dependencia npm no está instalada o el constructor falla, se omite con
  // un aviso — no rompe el arranque de los canales credential-free.
  for (const a of CREDENTIAL_ADAPTERS) {
    if (reg.get(a.id as any)) continue;
    try {
      const mod = await a.load();
      const Cls = mod[a.cls];
      if (typeof Cls === 'function') reg.register(new Cls());
    } catch (e: any) {
      console.warn(`[channels] adapter '${a.id}' no registrable (dep o init): ${e?.message ?? e}`);
    }
  }

  reg.bindHandler(opts.handler ?? orchestratorHandler);
  const r = await reg.start();
  _started = true;
  return r;
}

/** Test helper: reinicia la marca de arranque. */
export function _resetChannelsWiring(): void { _started = false; }
