/**
 * A2A Protocol — Agent-to-Agent. Permite que OTRO agente (Shinobi o
 * cualquier sistema compatible) invoque capacidades de este Shinobi de
 * forma estructurada, con discovery + token-auth + audit hook.
 *
 * Filosofía:
 *   - Envelope JSON pequeño y estable (versión 1).
 *   - Discovery: agent_card descriptivo (no Anthropic Skills — esto es
 *     superior: declara *capacidades* arbitrarias, no solo skills).
 *   - Auth: shared secret HMAC (Bearer token + body HMAC opcional).
 *   - Trazabilidad: traceId por envelope, propagable a sub-llamadas.
 *
 * Diferenciador: Hermes y OpenClaw no exponen API estable para hablar
 * de agente a agente. Shinobi puede actuar como nodo de una malla.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type A2AIntentKind =
  | 'ping'
  | 'capability_invoke'
  | 'memory_query'
  | 'mission_handoff'
  | 'health';

export interface A2AEnvelope<P = unknown> {
  /** Versión del protocolo. */
  v: 1;
  /** Identificador del envelope para trazas. */
  traceId: string;
  /** Identificador del agente origen. */
  from: string;
  /** Identificador del agente destino. */
  to: string;
  /** Tipo de operación. */
  intent: A2AIntentKind;
  /** Payload — esquema depende de intent. */
  payload: P;
  /** Timestamp ISO de emisión. */
  ts: string;
}

export interface A2AResponse<R = unknown> {
  v: 1;
  traceId: string;
  ok: boolean;
  result?: R;
  error?: string;
  ts: string;
}

export interface AgentCard {
  agentId: string;
  displayName: string;
  version: string;
  capabilities: AgentCapability[];
  /** intent kinds que el agente soporta. */
  intents: A2AIntentKind[];
  /** Auth disponible: 'none' | 'bearer' | 'hmac'. */
  auth: 'none' | 'bearer' | 'hmac';
  /** URL pública si aplica. */
  endpoint?: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  /** Parámetros aceptados (JSONSchema-lite). */
  params?: Record<string, { type: string; required?: boolean; description?: string }>;
}

export type IntentHandler = (env: A2AEnvelope) => Promise<{ result?: unknown; error?: string }>;

export interface DispatcherOptions {
  /** ID propio de este agente — todos los envelopes deben tener to === selfId. */
  selfId: string;
  /** Auth mode: 'none' (anything goes), 'bearer' (Authorization: Bearer <token>), 'hmac'. */
  auth?: 'none' | 'bearer' | 'hmac';
  /** Para auth='bearer' o 'hmac'. */
  sharedSecret?: string;
  /** Si true, no falla si traceId está vacío — lo regenera. */
  allowMissingTrace?: boolean;
  /** Hook llamado tras cada envelope despachado (para audit). */
  onEvent?: (info: {
    env: A2AEnvelope; ok: boolean; durationMs: number; error?: string;
  }) => void;
}

const VALID_INTENTS: ReadonlySet<A2AIntentKind> = new Set([
  'ping', 'capability_invoke', 'memory_query', 'mission_handoff', 'health',
]);

export function isValidEnvelope(x: unknown): x is A2AEnvelope {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  if (e.v !== 1) return false;
  if (typeof e.from !== 'string' || !e.from) return false;
  if (typeof e.to !== 'string' || !e.to) return false;
  if (typeof e.intent !== 'string' || !VALID_INTENTS.has(e.intent as A2AIntentKind)) return false;
  if (typeof e.ts !== 'string') return false;
  return true;
}

export function generateTraceId(): string {
  return 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Comparación de strings en tiempo constante (evita timing oracle sobre el secreto). */
export function safeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? '', 'utf-8');
  const bb = Buffer.from(b ?? '', 'utf-8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyHmac(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = signBody(body, secret);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export class A2ADispatcher {
  private handlers = new Map<A2AIntentKind, IntentHandler>();
  constructor(public readonly opts: DispatcherOptions) {
    if ((opts.auth === 'bearer' || opts.auth === 'hmac') && !opts.sharedSecret) {
      throw new Error(`A2ADispatcher: auth=${opts.auth} requires sharedSecret`);
    }
  }

  on(intent: A2AIntentKind, handler: IntentHandler): this {
    this.handlers.set(intent, handler);
    return this;
  }

  /**
   * Recibe un envelope crudo + headers/auth y devuelve A2AResponse.
   * No lanza — todos los errores van al campo `error`.
   */
  async dispatch(
    raw: unknown,
    auth?: { bearer?: string; signature?: string; rawBody?: string }
  ): Promise<A2AResponse> {
    const t0 = Date.now();
    let env: A2AEnvelope;

    if (!isValidEnvelope(raw)) {
      return this.errOut(generateTraceId(), 'envelope_invalid', t0, undefined);
    }
    env = raw as A2AEnvelope;
    if (!env.traceId) {
      if (!this.opts.allowMissingTrace) {
        return this.errOut(generateTraceId(), 'traceId_missing', t0, env);
      }
      env = { ...env, traceId: generateTraceId() };
    }
    if (env.to !== this.opts.selfId) {
      return this.errOut(env.traceId, `wrong_destination: to=${env.to}`, t0, env);
    }

    const authMode = this.opts.auth ?? 'none';
    if (authMode === 'bearer') {
      if (!auth?.bearer || !safeStrEqual(auth.bearer, this.opts.sharedSecret ?? '')) {
        return this.errOut(env.traceId, 'unauthorized', t0, env);
      }
    } else if (authMode === 'hmac') {
      if (!auth?.rawBody || !auth?.signature ||
          !verifyHmac(auth.rawBody, auth.signature, this.opts.sharedSecret!)) {
        return this.errOut(env.traceId, 'hmac_invalid', t0, env);
      }
    }

    const handler = this.handlers.get(env.intent);
    if (!handler) {
      return this.errOut(env.traceId, `no_handler_for_intent:${env.intent}`, t0, env);
    }

    try {
      const out = await handler(env);
      const ok = !out.error;
      const resp: A2AResponse = {
        v: 1,
        traceId: env.traceId,
        ok,
        result: out.result,
        error: out.error,
        ts: new Date().toISOString(),
      };
      this.opts.onEvent?.({ env, ok, durationMs: Date.now() - t0, error: out.error });
      return resp;
    } catch (err) {
      const msg = (err as Error).message;
      const errStr = `handler_threw:${msg}`;
      this.opts.onEvent?.({ env, ok: false, durationMs: Date.now() - t0, error: errStr });
      return { v: 1, traceId: env.traceId, ok: false, error: errStr, ts: new Date().toISOString() };
    }
  }

  private errOut(traceId: string, error: string, t0: number, env: A2AEnvelope | undefined): A2AResponse {
    if (env) this.opts.onEvent?.({ env, ok: false, durationMs: Date.now() - t0, error });
    return { v: 1, traceId, ok: false, error, ts: new Date().toISOString() };
  }
}

export function buildAgentCard(opts: {
  agentId: string;
  displayName: string;
  version: string;
  capabilities: AgentCapability[];
  intents?: A2AIntentKind[];
  auth?: AgentCard['auth'];
  endpoint?: string;
}): AgentCard {
  return {
    agentId: opts.agentId,
    displayName: opts.displayName,
    version: opts.version,
    capabilities: opts.capabilities,
    intents: opts.intents ?? Array.from(VALID_INTENTS),
    auth: opts.auth ?? 'none',
    endpoint: opts.endpoint,
  };
}
