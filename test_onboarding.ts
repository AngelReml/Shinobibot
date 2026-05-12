// test_onboarding.ts
//
// Bloque 7 — E2E del onboarding web universal.
//
// Mockea axios.get para no hablar con providers reales. Cubre:
//   A. validateKey('') de cada provider → ok:false (empty)
//   B. validateKey con HTTP 401 mock → ok:false con error específico
//   C. validateKey con HTTP 200 mock → ok:true
//   D. POST /api/onboarding con provider/key vacíos → 400
//   E. POST /api/onboarding con validación OK (mock) → escribe config + 200
//   F. POST /api/onboarding/skip con config previa → 200
//   G. POST /api/onboarding/skip sin config → 400
//   H. provider_router.currentProvider() respeta SHINOBI_PROVIDER

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import axios from 'axios';

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} [${ms}ms] ${name} — ${detail}`);
}

// Sandbox tmp + redirigir el config dir de Shinobi.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-onboarding-test-'));
process.env.APPDATA = sandbox; // first_run_wizard usa APPDATA para ubicar config.json
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Mock axios — interceptamos en lugar de hablar con providers reales.
const originalGet = axios.get;
const originalPost = axios.post;
let mockGet: (url: string, config?: any) => Promise<any> = async () => ({ status: 200 });
let mockPost: (url: string, body?: any, config?: any) => Promise<any> = async () => ({ status: 200, data: { choices: [{ message: { role: 'assistant', content: 'mocked' } }] } });
(axios as any).get = (url: string, config?: any) => mockGet(url, config);
(axios as any).post = (url: string, body?: any, config?: any) => mockPost(url, body, config);

const { groqClient } = await import('./src/providers/groq_client.js');
const { openaiClient } = await import('./src/providers/openai_client.js');
const { anthropicClient } = await import('./src/providers/anthropic_client.js');
const { openrouterClient } = await import('./src/providers/openrouter_client.js');
const { currentProvider } = await import('./src/providers/provider_router.js');
const { loadConfig } = await import('./src/runtime/first_run_wizard.js');
const { startWebServer } = await import('./src/web/server.js');

const PORT = 14001;
const dbPath = path.join(sandbox, 'web_chat.db');
await startWebServer({ port: PORT, dbPath });
await new Promise(r => setTimeout(r, 200));

async function main() {
  // ─── A: validateKey('') ──────────────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const r1 = await groqClient.validateKey('');
      const r2 = await openaiClient.validateKey('');
      const r3 = await anthropicClient.validateKey('   ');
      const r4 = await openrouterClient.validateKey('');
      const ok = !r1.ok && !r2.ok && !r3.ok && !r4.ok;
      record('A. validateKey vacía rechazada por los 4 providers', ok,
        `groq=${r1.ok}, openai=${r2.ok}, anthropic=${r3.ok}, openrouter=${r4.ok}`,
        t0);
    } catch (e: any) {
      record('A. validateKey vacía rechazada', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── B: validateKey con HTTP 401 mock → ok:false con mensaje específico ─
  {
    const t0 = Date.now();
    try {
      mockGet = async () => { const err: any = new Error('Request failed'); err.response = { status: 401 }; throw err; };
      const r = await groqClient.validateKey('gsk_fake_key');
      const ok = !r.ok && r.status === 401 && /no es válida/.test(r.error || '');
      record('B. HTTP 401 → ok:false con mensaje específico', ok,
        `ok=${r.ok}, status=${r.status}, error_has_hint=${/no es válida/.test(r.error || '')}`,
        t0);
    } catch (e: any) {
      record('B. HTTP 401 → ok:false', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── C: validateKey con HTTP 200 mock → ok:true ──────────────────────────
  {
    const t0 = Date.now();
    try {
      mockGet = async () => ({ status: 200 });
      const r1 = await groqClient.validateKey('gsk_xyz');
      const r2 = await anthropicClient.validateKey('sk-ant-xyz');
      const ok = r1.ok && r2.ok;
      record('C. HTTP 200 → ok:true', ok, `groq=${r1.ok}, anthropic=${r2.ok}`, t0);
    } catch (e: any) {
      record('C. HTTP 200 → ok:true', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── D: POST /api/onboarding con campos vacíos → 400 ─────────────────────
  {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: '', key: '' }),
      });
      record('D. POST /api/onboarding vacío → 400', r.status === 400, `status=${r.status}`, t0);
    } catch (e: any) {
      record('D. POST /api/onboarding vacío → 400', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── E: POST /api/onboarding con validación OK (mock) → escribe config + 200 ─
  {
    const t0 = Date.now();
    try {
      mockGet = async () => ({ status: 200 });
      const r = await fetch(`http://127.0.0.1:${PORT}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'groq', key: 'gsk_test_valid' }),
      });
      const data: any = r.ok ? await r.json() : null;
      const cfg = loadConfig();
      const envOk = process.env.SHINOBI_PROVIDER === 'groq' && process.env.SHINOBI_PROVIDER_KEY === 'gsk_test_valid';
      const pass = r.status === 200 && data?.ok === true && !!cfg && cfg.provider === 'groq' && cfg.provider_key === 'gsk_test_valid' && envOk;
      record('E. POST onboarding OK → config + env actualizados', pass,
        `status=${r.status}, provider_in_cfg=${cfg?.provider}, env_provider=${process.env.SHINOBI_PROVIDER}, model_default=${data?.modelDefault}`,
        t0);
    } catch (e: any) {
      record('E. POST onboarding OK → config + env', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── F: POST /api/onboarding/skip con config previa → 200 ────────────────
  {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/onboarding/skip`, { method: 'POST' });
      const data: any = await r.json();
      record('F. /api/onboarding/skip con config previa → 200', r.status === 200 && data.ok === true, `status=${r.status}, ok=${data.ok}, currentProvider=${data.currentProvider}`, t0);
    } catch (e: any) {
      record('F. /api/onboarding/skip con config → 200', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── G: POST /api/onboarding/skip sin config → 400 ───────────────────────
  // Borra la config del sandbox y prueba.
  {
    const t0 = Date.now();
    try {
      const cfgFile = path.join(sandbox, 'Shinobi', 'config.json');
      if (fs.existsSync(cfgFile)) fs.unlinkSync(cfgFile);
      const r = await fetch(`http://127.0.0.1:${PORT}/api/onboarding/skip`, { method: 'POST' });
      record('G. /api/onboarding/skip sin config → 400', r.status === 400, `status=${r.status}`, t0);
    } catch (e: any) {
      record('G. /api/onboarding/skip sin config → 400', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── H: currentProvider respeta SHINOBI_PROVIDER ─────────────────────────
  {
    const t0 = Date.now();
    try {
      const prev = process.env.SHINOBI_PROVIDER;
      process.env.SHINOBI_PROVIDER = 'anthropic';
      const a = currentProvider();
      delete process.env.SHINOBI_PROVIDER;
      const b = currentProvider();
      process.env.SHINOBI_PROVIDER = 'bogus';
      const c = currentProvider();
      if (prev !== undefined) process.env.SHINOBI_PROVIDER = prev; else delete process.env.SHINOBI_PROVIDER;
      const ok = a === 'anthropic' && b === 'opengravity' && c === 'opengravity';
      record('H. currentProvider() respeta env', ok, `set='anthropic'→${a}, unset→${b}, bogus→${c}`, t0);
    } catch (e: any) {
      record('H. currentProvider() respeta env', false, `threw: ${e.message}`, t0);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} tests passed`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name} (${r.ms}ms)`);
  console.log('═════════════════════════════════════════════════════');

  // restore axios
  (axios as any).get = originalGet;
  (axios as any).post = originalPost;
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
