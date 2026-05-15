#!/usr/bin/env node
/**
 * Prueba funcional Sprint P1.4 — ACP estándar.
 *
 * Simula un cliente ACP que:
 *   1. Envía `initialize` JSON-RPC.
 *   2. Recibe `result` con capabilities.
 *   3. Envía `session/prompt` con un texto.
 *   4. Recibe respuesta del handler de Shinobi (mockeado).
 *
 * NO arrancamos servidor HTTP real — eso lo cubre el sprint que
 * integra el adapter en src/web/. Aquí validamos que la traducción
 * ACP ↔ A2A funciona end-to-end + agent_card es JSON válido + paths
 * del registry existen.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAcpRequest, acpRequestToEnvelope, envelopeResponseToAcp, acpAgentCard,
} from '../../src/a2a/acp_adapter.js';
import { A2ADispatcher } from '../../src/a2a/protocol.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint P1.4 — ACP estándar ===');

  // ── 1. acp_registry/agent.json válido ──
  console.log('\n--- 1. acp_registry/agent.json en raíz ---');
  const registryPath = join(process.cwd(), 'acp_registry', 'agent.json');
  check(existsSync(registryPath), 'agent.json existe');
  const card = JSON.parse(readFileSync(registryPath, 'utf-8'));
  check(card.protocol === 'acp/1', 'protocol acp/1');
  check(card.agent.agentId === 'shinobi', 'agentId=shinobi');
  check(Array.isArray(card.agent.capabilities) && card.agent.capabilities.length >= 5, 'capabilities >= 5');
  check(card.jsonRpcMethods.includes('initialize'), 'declara initialize');
  check(card.jsonRpcMethods.includes('session/prompt'), 'declara session/prompt');

  // ── 2. Build dispatcher con handlers reales ──
  console.log('\n--- 2. Dispatcher recibe envelope desde ACP ---');
  const dispatcher = new A2ADispatcher({
    selfId: 'shinobi',
    auth: 'none',
  });
  dispatcher.on('ping', async () => ({ result: { capabilities: ['loop_detector_v3', 'committee_voting'] } }));
  dispatcher.on('capability_invoke', async (env) => ({
    result: { reply: `Shinobi recibió: ${JSON.stringify((env.payload as any).acpParams)}` },
  }));

  // ── 3. Simular round-trip ACP → envelope → response → ACP ──
  console.log('\n--- 3. Round-trip initialize ---');
  const initRaw = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'acp/1' } };
  const initParsed = parseAcpRequest(initRaw);
  check(initParsed !== null, 'parseAcpRequest OK');
  const initEnv = acpRequestToEnvelope(initParsed!, { selfId: 'shinobi', from: 'zed' });
  check(initEnv?.intent === 'ping', 'initialize → ping');
  const initResp = await dispatcher.dispatch(initEnv!);
  check(initResp.ok === true, 'dispatcher.ok=true');
  const initAcp = envelopeResponseToAcp(initParsed!.id, initResp);
  check(initAcp.result !== undefined, 'ACP response tiene result');
  check((initAcp.result as any).capabilities.length === 2, 'capabilities propagadas');

  // ── 4. Round-trip session/prompt ──
  console.log('\n--- 4. Round-trip session/prompt ---');
  const promptRaw = { jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { text: 'audita repo X' } };
  const env2 = acpRequestToEnvelope(parseAcpRequest(promptRaw)!, { selfId: 'shinobi', from: 'zed' })!;
  check(env2.intent === 'capability_invoke', 'session/prompt → capability_invoke');
  const resp2 = await dispatcher.dispatch(env2);
  check(resp2.ok === true, 'dispatcher resp ok');
  const acpResp2 = envelopeResponseToAcp(2, resp2);
  check((acpResp2.result as any).reply.includes('audita repo X'), 'params propagados al handler');

  // ── 5. Error cases ──
  console.log('\n--- 5. Manejo de errores estándar JSON-RPC ---');
  const badMethod = { jsonrpc: '2.0', id: 3, method: 'unknown/method' };
  const envBad = acpRequestToEnvelope(parseAcpRequest(badMethod)!);
  check(envBad === null, 'método desconocido → null envelope');

  const badRpc = parseAcpRequest({ method: 'x' }); // sin jsonrpc/id
  check(badRpc === null, 'request sin jsonrpc → null');

  const errResp = envelopeResponseToAcp(1, { ok: false, error: 'no_handler_for_intent:health' });
  check(errResp.error?.code === -32601, 'no_handler → -32601 (JSON-RPC Method not found)');

  // ── 6. agent_card helper ──
  console.log('\n--- 6. acpAgentCard helper ---');
  const built = acpAgentCard({
    agentId: 'shinobi',
    displayName: 'Shinobi',
    version: '0.3.2',
    endpoint: 'http://localhost:3333/acp',
    capabilities: [{ name: 'browse', description: 'X' }],
  });
  check(built.protocol === 'acp/1', 'protocol acp/1');
  check(built.agent.endpoint === 'http://localhost:3333/acp', 'endpoint correcto');

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · Shinobi habla ACP estándar (cualquier cliente JSON-RPC ACP puede conectar)');
}

main().catch((e) => {
  console.error('Sprint P1.4 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
