/**
 * Cableado A2A (P2). Construye el A2ADispatcher de Shinobi con sus handlers
 * y el agent card de discovery. El web server monta:
 *   - GET  /.well-known/agent-card.json  → discovery
 *   - POST /a2a                          → dispatch de envelopes
 *
 * Auth: si SHINOBI_A2A_SECRET está definida → HMAC; si no → 'none' (LAN).
 */

import { A2ADispatcher, buildAgentCard, type AgentCard } from './protocol.js';

export interface A2AWiring {
  /** Consulta semántica de memoria — recibe { query, limit? } devuelve array de entradas. */
  recallMemory?: (query: string, limit?: number) => Promise<Array<{ id: string; content: string; score: number }>>;
  /** Cola/despacho de misiones recibidas de otros agentes — recibe { task, context? }. */
  enqueueMission?: (task: string, context?: string) => Promise<{ queued: boolean; missionId?: string }>;
}

function selfId(): string {
  return process.env.SHINOBI_A2A_ID || 'shinobi';
}

/** Dispatcher A2A de Shinobi con sus intent handlers cableados. */
export function buildA2ADispatcher(wiring: A2AWiring = {}): A2ADispatcher {
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

  d.on('memory_query', async (env) => {
    const query = (env.payload as any)?.query;
    if (typeof query !== 'string' || !query.trim()) {
      return { error: 'memory_query: campo "query" (string) requerido' };
    }
    const limit = (env.payload as any)?.limit ?? 10;
    if (!wiring.recallMemory) {
      return { error: 'memory_query: memoria semántica no disponible en este runtime' };
    }
    try {
      const results = await wiring.recallMemory(query, limit);
      return { result: { query, results } };
    } catch (e: any) {
      return { error: `memory_query: ${e?.message ?? String(e)}` };
    }
  });

  d.on('mission_handoff', async (env) => {
    const task = (env.payload as any)?.task;
    if (typeof task !== 'string' || !task.trim()) {
      return { error: 'mission_handoff: campo "task" (string) requerido' };
    }
    const context = (env.payload as any)?.context;
    if (!wiring.enqueueMission) {
      return { error: 'mission_handoff: cola de misiones no disponible en este runtime' };
    }
    try {
      const r = await wiring.enqueueMission(task, context);
      return { result: r };
    } catch (e: any) {
      return { error: `mission_handoff: ${e?.message ?? String(e)}` };
    }
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
      { name: 'memory_query', description: 'Consulta semántica de la memoria curada del agente.' },
      { name: 'mission_handoff', description: 'Entrega una misión para ejecución por este agente.' },
    ],
    intents: ['ping', 'health', 'capability_invoke', 'memory_query', 'mission_handoff'],
    auth: process.env.SHINOBI_A2A_SECRET ? 'hmac' : 'none',
    endpoint,
  });
}
