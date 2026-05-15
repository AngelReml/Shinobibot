/**
 * ACP Adapter — traduce mensajes Agent Client Protocol (Zed/Hermes/
 * OpenClaw IDE bridge) al envelope interno A2A de Shinobi.
 *
 * El estándar ACP (https://github.com/zed-industries/agent-client-protocol)
 * usa JSON-RPC 2.0 sobre stdio/HTTP con métodos:
 *   - `initialize`            → handshake + agent capabilities
 *   - `session/new`           → crear sesión
 *   - `session/prompt`        → enviar mensaje del usuario
 *   - `session/cancel`        → cancelar prompt en curso
 *   - `session/load`          → reabrir sesión existente
 *
 * Nosotros NO implementamos un cliente ACP completo (eso es la librería
 * `@zed-industries/agent-client-protocol`). Aquí implementamos:
 *
 *   - `parseAcpRequest`: valida estructura JSON-RPC + extrae método/params.
 *   - `acpRequestToEnvelope`: traduce ACP method → A2A envelope.
 *   - `envelopeResponseToAcp`: traduce A2A response → JSON-RPC response.
 *   - `acpAgentCard`: devuelve el agent_card en formato JSON que sirve
 *     el endpoint `GET /.well-known/agent-card.json` (estándar ACP).
 *
 * Así Shinobi puede coexistir con cualquier cliente ACP (Zed, Hermes
 * gateway, etc.) sin re-implementar la lógica interna.
 */

import type { A2AEnvelope, A2AIntentKind, AgentCard } from './protocol.js';
import { generateTraceId } from './protocol.js';

export interface AcpRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface AcpRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const ACP_TO_INTENT: Record<string, A2AIntentKind> = {
  'initialize': 'ping',
  'session/new': 'mission_handoff',
  'session/prompt': 'capability_invoke',
  'session/load': 'memory_query',
  'session/cancel': 'mission_handoff',
};

/**
 * Valida que un objeto es un request JSON-RPC 2.0 con método válido.
 */
export function parseAcpRequest(raw: unknown): AcpRpcRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as AcpRpcRequest;
  if (r.jsonrpc !== '2.0') return null;
  if (typeof r.method !== 'string' || !r.method) return null;
  if (typeof r.id !== 'number' && typeof r.id !== 'string') return null;
  return r;
}

/**
 * Convierte un ACP request → A2A envelope que el dispatcher interno
 * sabe procesar. Si el método no tiene mapping, devuelve null.
 */
export function acpRequestToEnvelope(
  req: AcpRpcRequest,
  opts: { selfId: string; from?: string } = { selfId: 'shinobi' }
): A2AEnvelope | null {
  const intent = ACP_TO_INTENT[req.method];
  if (!intent) return null;
  return {
    v: 1,
    traceId: 'acp_' + req.id + '_' + generateTraceId(),
    from: opts.from ?? 'acp-client',
    to: opts.selfId,
    intent,
    payload: {
      acpMethod: req.method,
      acpParams: req.params ?? {},
    },
    ts: new Date().toISOString(),
  };
}

/**
 * Convierte la respuesta interna de Shinobi (A2AResponse) en una
 * respuesta JSON-RPC 2.0 lista para devolver al cliente ACP.
 */
export function envelopeResponseToAcp(
  acpRequestId: number | string,
  resp: { ok: boolean; result?: unknown; error?: string }
): AcpRpcResponse {
  if (!resp.ok) {
    return {
      jsonrpc: '2.0',
      id: acpRequestId,
      error: {
        code: errorCodeFor(resp.error),
        message: resp.error ?? 'unknown_error',
      },
    };
  }
  return {
    jsonrpc: '2.0',
    id: acpRequestId,
    result: resp.result ?? null,
  };
}

function errorCodeFor(msg?: string): number {
  if (!msg) return -32000;
  if (msg === 'unauthorized') return -32001;
  if (msg.includes('hmac_invalid')) return -32001;
  if (msg.includes('envelope_invalid') || msg === 'traceId_missing') return -32600;
  if (msg.includes('no_handler_for_intent')) return -32601;
  if (msg.includes('wrong_destination')) return -32602;
  return -32000;
}

/**
 * Devuelve el agent_card en formato ACP estándar (compatible Zed +
 * Hermes acp_registry). Sirve para `GET /.well-known/agent-card.json`.
 */
export function acpAgentCard(opts: {
  agentId: string;
  displayName: string;
  version: string;
  endpoint?: string;
  capabilities: Array<{ name: string; description: string }>;
}): {
  protocol: 'acp/1';
  agent: AgentCard;
  jsonRpcMethods: string[];
} {
  return {
    protocol: 'acp/1',
    agent: {
      agentId: opts.agentId,
      displayName: opts.displayName,
      version: opts.version,
      capabilities: opts.capabilities,
      intents: ['ping', 'capability_invoke', 'memory_query', 'mission_handoff', 'health'],
      auth: 'bearer',
      endpoint: opts.endpoint,
    },
    jsonRpcMethods: Object.keys(ACP_TO_INTENT),
  };
}
