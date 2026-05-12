// test_gateway.ts
//
// Bloque 6 — E2E del gateway multicanal:
//   A. HTTP con token correcto → 200 + response
//   B. HTTP sin token          → 401
//   C. HTTP con token erróneo  → 401
//   D. Telegram allowlist user  → procesado (handleMessage returns reply)
//   E. Telegram fuera allowlist → ignorado (returns '')
//   F. parseAllowedUserIds + getLanAddresses
//
// Mockea OpenGravityClient.invokeLLM para no depender del LLM real.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseAllowedUserIds, startGateway } from './src/gateway/index.js';
import { startTelegramChannel } from './src/gateway/telegram_channel.js';
import { getLanAddresses } from './src/gateway/webchat_channel.js';
import { ChatStore } from './src/web/chat_store.js';

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} [${ms}ms] ${name} — ${detail}`);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-gateway-test-'));
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Mock the LLM (must be before importing the orchestrator).
const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
(OpenGravityClient as any).invokeLLM = async () => ({
  success: true,
  output: JSON.stringify({ role: 'assistant', content: 'Synthetic response from mocked LLM.' }),
  error: '',
});

const TOKEN = 'test-gateway-token-12345';
const PORT = 13901;
const HOST = '127.0.0.1';

async function main() {
  const chatStore = new ChatStore(path.join(sandbox, 'web_chat.db'));
  const gw = await startGateway({
    port: PORT,
    host: HOST,
    token: TOKEN,
    chatStore,
  });

  // ─── A: HTTP con token correcto ─────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hola desde test A' }),
      });
      const ok = r.status === 200;
      const data: any = ok ? await r.json() : null;
      const hasResponse = !!data?.response && data.response.length > 0;
      record('A. HTTP con token correcto', ok && hasResponse,
        `status=${r.status}, response.length=${data?.response?.length ?? 0}`,
        t0);
    } catch (e: any) {
      record('A. HTTP con token correcto', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── B: HTTP sin token → 401 ────────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hola' }),
      });
      record('B. HTTP sin token → 401', r.status === 401, `status=${r.status}`, t0);
    } catch (e: any) {
      record('B. HTTP sin token → 401', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── C: HTTP con token erróneo → 401 ─────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/chat`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer wrong-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hola' }),
      });
      record('C. HTTP con token erróneo → 401', r.status === 401, `status=${r.status}`, t0);
    } catch (e: any) {
      record('C. HTTP con token erróneo → 401', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── D: Telegram user en allowlist → procesado ──────────────────────────
  // Usamos startTelegramChannel con dryRun:true para no abrir polling real.
  const allowedId = 4242;
  const notAllowedId = 9999;
  const tg = await startTelegramChannel({
    botToken: 'fake-token-for-dryrun',
    allowedUserIds: [allowedId],
    chatStore,
    dryRun: true,
  });
  {
    const t0 = Date.now();
    try {
      const reply = await tg.handleMessage(allowedId, 'mensaje de allowlist user');
      record('D. Telegram allowlist → procesado', reply.length > 0,
        `reply.length=${reply.length}, preview="${reply.slice(0, 60)}"`,
        t0);
    } catch (e: any) {
      record('D. Telegram allowlist → procesado', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── E: Telegram user fuera de allowlist → ignorado ─────────────────────
  {
    const t0 = Date.now();
    try {
      const reply = await tg.handleMessage(notAllowedId, 'spam desde user no autorizado');
      record('E. Telegram fuera allowlist → ignorado', reply === '',
        `reply="${reply}"`,
        t0);
    } catch (e: any) {
      record('E. Telegram fuera allowlist → ignorado', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── F: parseAllowedUserIds + getLanAddresses ───────────────────────────
  {
    const t0 = Date.now();
    try {
      const parsed = parseAllowedUserIds('123, 456,789, abc, 0');
      const ok1 = parsed.length === 4 && parsed[0] === 123 && parsed[3] === 0;
      const parsedEmpty = parseAllowedUserIds(undefined);
      const ok2 = parsedEmpty.length === 0;
      const lan = getLanAddresses();
      const ok3 = Array.isArray(lan); // host puede no tener interfaces no-loopback en CI; sólo verificamos forma
      record('F. parseAllowedUserIds + getLanAddresses', ok1 && ok2 && ok3,
        `parsed=${JSON.stringify(parsed)}, empty=${parsedEmpty.length}, lan_count=${lan.length}`,
        t0);
    } catch (e: any) {
      record('F. parseAllowedUserIds + getLanAddresses', false, `threw: ${e.message}`, t0);
    }
  }

  await tg.stop();
  await gw.stop();

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} tests passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)`);
  console.log('═════════════════════════════════════════════════════');

  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
