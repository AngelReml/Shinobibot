/**
 * Validación REAL de los fixes P3 del web server:
 *   - express.json({ limit: '1mb' }): un body gigante devuelve 413.
 *   - WS anti-CSWSH: un upgrade con Origin que no coincide con el host se
 *     rechaza; con Origin correcto se acepta.
 *
 * Arranca el web server REAL, hace peticiones HTTP/WS reales contra él.
 * Run: npx tsx scripts/audit_validation/p3_webserver_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';
import { startWebServer } from '../../src/web/server.js';

const PORT = 3399;
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Conecta un WS con un header Origin dado; devuelve 'open' o 'closed:<code>'. */
function probeWs(origin: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { headers: { Origin: origin } });
    let settled = false;
    const done = (v: string) => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(v); } };
    ws.on('close', (code) => done(`closed:${code}`));
    ws.on('error', () => done('error'));
    ws.on('open', () => setTimeout(() => done(ws.readyState === WebSocket.OPEN ? 'open' : `closed:${ws.readyState}`), 400));
    setTimeout(() => done('timeout'), 4000);
  });
}

async function main() {
  const tmpDb = join(mkdtempSync(join(tmpdir(), 'shinobi-websrv-')), 'web_chat.db');
  await startWebServer({ port: PORT, dbPath: tmpDb });
  await sleep(300);

  // ── express.json limit: body > 1mb -> 413 ────────────────────────────
  console.log('\n=== P3 · express.json limit ===');
  const bigBody = JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }); // ~2 MB
  let status = 0;
  try {
    const resp = await fetch(`http://localhost:${PORT}/api/onboarding`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bigBody,
    });
    status = resp.status;
  } catch (e: any) {
    status = -1;
  }
  console.log(`  POST /api/onboarding con body ~2MB -> HTTP ${status}`);
  check('body > 1mb rechazado (413)', status === 413, `esperado 413, got ${status}`);

  const smallResp = await fetch(`http://localhost:${PORT}/api/onboarding/status`).then(r => r.status).catch(() => -1);
  check('petición normal sigue respondiendo', smallResp === 200, `GET /api/onboarding/status -> ${smallResp}`);

  // ── WS anti-CSWSH ─────────────────────────────────────────────────────
  console.log('\n=== P3 · WS Origin check (anti-CSWSH) ===');
  const badOrigin = await probeWs('http://evil.attacker.example');
  console.log(`  WS con Origin malicioso -> ${badOrigin}`);
  check('WS con Origin ajeno RECHAZADO', badOrigin.startsWith('closed:'), 'debe cerrarse, no quedar abierto');

  const goodOrigin = await probeWs(`http://localhost:${PORT}`);
  console.log(`  WS con Origin correcto  -> ${goodOrigin}`);
  check('WS con Origin del propio host ACEPTADO', goodOrigin === 'open', 'el cliente legítimo debe poder conectar');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
