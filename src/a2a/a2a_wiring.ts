/**
 * Cableado A2A (P2). Construye el A2ADispatcher de Shinobi con sus handlers
 * y el agent card de discovery. El web server monta:
 *   - GET  /.well-known/agent-card.json  → discovery
 *   - POST /a2a                          → dispatch de envelopes
 *
 * Auth: si SHINOBI_A2A_SECRET está definida → HMAC; si no → 'none' (LAN).
 */

import { A2ADispatcher, buildAgentCard, type AgentCard } from './protocol.js';

function selfId(): string {
  return process.env.SHINOBI_A2A_ID || 'shinobi';
}

/** Dispatcher A2A de Shinobi con sus intent handlers cableados. */
export function buildA2ADispatcher(): A2ADispatcher {
  const secret = process.env.SHINOBI_A2A_SECRET;
  const d = new A2ADispatcher({
    selfId: selfId(),
    auth: secret ? 'hmac' : 'none',
    sharedSecret: secret,
    allowMissingTrace: true,
  });
  d.on('ping', async () => ({ result: { pong: true, ts: new Date().toISOString() } }));
  d.on('health', async () => ({ result: { status: 'ok', agent: selfId(), v: 1 } }));
  d.on('capability_invoke', async (env) => {
    const cap = (env.payload as any)?.capability;
    if (cap === 'ping' || cap === 'health') {
      return { result: { invoked: cap, ok: true } };
    }
    return { error: `capability no expuesta vía A2A: ${cap}` };
  });
  return d;
}

/** Agent card de discovery de Shinobi. */
export function shinobiAgentCard(endpoint?: string): AgentCard {
  return buildAgentCard({
    agentId: selfId(),
    displayName: 'Shinobi',
    version: '1.0.0',
    capabilities: [
      { name: 'ping', description: 'Liveness check del agente.' },
      { name: 'health', description: 'Estado/salud del agente.' },
    ],
    intents: ['ping', 'health', 'capability_invoke'],
    auth: process.env.SHINOBI_A2A_SECRET ? 'hmac' : 'none',
    endpoint,
  });
}
