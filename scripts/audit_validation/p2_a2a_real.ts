/**
 * Validación REAL del cableado P2 de A2A.
 * Arranca el web server real y comprueba que otro agente puede:
 *   - descubrir a Shinobi vía GET /.well-known/agent-card.json
 *   - invocarlo vía POST /a2a con un envelope A2A real (ping → pong).
 *
 * Run: npx tsx scripts/audit_validation/p2_a2a_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startWebServer } from '../../src/web/server.js';
import { generateTraceId } from '../../src/a2a/protocol.js';

const PORT = 3401;
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  delete process.env.SHINOBI_A2A_SECRET; // modo 'none' para la prueba
  const tmpDb = join(mkdtempSync(join(tmpdir(), 'shinobi-a2a-')), 'web.db');
  await startWebServer({ port: PORT, dbPath: tmpDb });
  await new Promise((r) => setTimeout(r, 300));

  // 1. Discovery.
  console.log('=== 1. Discovery: GET /.well-known/agent-card.json ===');
  const card = await fetch(`http://localhost:${PORT}/.well-known/agent-card.json`).then((r) => r.json());
  console.log(`  agentId=${card.agentId}, intents=[${card.intents}], capabilities=${card.capabilities.length}`);
  check('el agent card se publica', card.agentId === 'shinobi' && Array.isArray(card.intents),
    `card v=${card.version}`);
  check('declara los intents soportados', card.intents.includes('ping') && card.intents.includes('health'),
    card.intents.join(','));

  // 2. Dispatch: POST /a2a con un envelope ping real.
  console.log('\n=== 2. Dispatch: POST /a2a (intent=ping) ===');
  const envelope = {
    v: 1, traceId: generateTraceId(), from: 'agente-externo', to: 'shinobi',
    intent: 'ping', payload: {}, ts: new Date().toISOString(),
  };
  const resp = await fetch(`http://localhost:${PORT}/a2a`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope),
  }).then((r) => r.json());
  console.log(`  respuesta: ${JSON.stringify(resp)}`);
  check('el dispatch responde ok', resp.ok === true, `traceId=${resp.traceId}`);
  check('el handler ping devuelve pong', resp.result?.pong === true, JSON.stringify(resp.result));

  // 3. Envelope mal dirigido se rechaza.
  console.log('\n=== 3. Envelope a otro destino se rechaza ===');
  const bad = { ...envelope, to: 'otro-agente', traceId: generateTraceId() };
  const badResp = await fetch(`http://localhost:${PORT}/a2a`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad),
  }).then((r) => r.json());
  console.log(`  respuesta: ok=${badResp.ok}, error=${badResp.error}`);
  check('rechaza envelope mal dirigido', badResp.ok === false && /wrong_destination/.test(badResp.error || ''),
    badResp.error ?? '');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
