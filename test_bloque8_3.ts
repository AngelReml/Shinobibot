// test_bloque8_3.ts
//
// Bloque 8.3 — E2E del chat Stitch (sin antesala).
// La antesala fue eliminada a petición del usuario. El chat es ahora
// la primera (y única) pantalla.
//
// Cubre:
//   A. Chat carga directo: #chat-app visible, conv activa creada
//   B. WebSocket conecta y procesa send → final
//   C. Toggle hiru→yoru cambia data-theme + bg

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-8-3-'));
process.env.APPDATA = sandbox;
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

const shinobiDir = path.join(sandbox, 'Shinobi');
fs.mkdirSync(shinobiDir, { recursive: true });
fs.writeFileSync(path.join(shinobiDir, 'config.json'), JSON.stringify({
  opengravity_api_key: 'test', opengravity_url: 'https://test.example/api',
  language: 'es', memory_path: path.join(shinobiDir, 'memory'),
  onboarded_at: new Date().toISOString(), version: '2.0.0',
}));

const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
(OpenGravityClient as any).invokeLLM = async () =>
  ({ success: true, output: JSON.stringify({ role: 'assistant', content: 'mocked' }), error: '' });
const orchModule = await import('./src/coordinator/orchestrator.js');
(orchModule.ShinobiOrchestrator as any).process = async (text: string) => ({ response: `Eco: ${text}` });

const { startWebServer } = await import('./src/web/server.js');
const PORT = 14301;
await startWebServer({ port: PORT, dbPath: path.join(sandbox, 'web_chat.db') });
await new Promise(r => setTimeout(r, 250));

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} [${ms}ms] ${name} — ${detail}`);
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });

  async function killTransitions(p: Page) {
    await p.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation: none !important; }',
    });
  }

  try {
    // ─── A. Chat carga directo ───────────────────────────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!(window as any).ShinobiConvs?.getActive?.(), { timeout: 5000 });
        const data = await page.evaluate(() => {
          const chat = document.getElementById('chat-app');
          const antesala = document.getElementById('antesala');
          return {
            chatPresent: !!chat,
            antesalaPresent: !!antesala,
            theme: document.documentElement.getAttribute('data-theme'),
            convsActive: !!(window as any).ShinobiConvs?.getActive?.(),
          };
        });
        const pass = data.chatPresent && !data.antesalaPresent && data.theme === 'hiru' && data.convsActive;
        record('A. Chat carga directo (sin antesala)', pass, JSON.stringify(data), t0);
      } catch (e: any) {
        record('A. Chat carga directo (sin antesala)', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

    // ─── B. WS conecta + send → final ────────────────────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!(window as any).ShinobiConvs?.getActive?.(), { timeout: 5000 });
        await killTransitions(page);
        await page.fill('#composer', 'hola desde test');
        await page.click('#send-btn');
        await page.waitForFunction(
          () => {
            const msgs = document.querySelectorAll('.chat-feed .msg.agent');
            if (msgs.length === 0) return false;
            const last = msgs[msgs.length - 1];
            return !last.classList.contains('pending');
          },
          undefined,
          { timeout: 10000 }
        );
        const data = await page.evaluate(() => {
          const agentMsg = document.querySelector('.chat-feed .msg.agent .body')?.textContent || '';
          return { agentMsg };
        });
        const pass = data.agentMsg.includes('Eco') || data.agentMsg.includes('hola');
        record('B. WS conecta + send → final', pass, `agentMsg="${data.agentMsg.slice(0, 80)}"`, t0);
      } catch (e: any) {
        record('B. WS conecta + send → final', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

    // ─── C. Toggle hiru→yoru cambia bg + data-theme ─────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#theme-toggle', { timeout: 5000 });
        await killTransitions(page);
        const before = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute('data-theme'),
          bg: getComputedStyle(document.body).backgroundColor,
        }));
        await page.click('#theme-toggle');
        await killTransitions(page);
        const after = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute('data-theme'),
          bg: getComputedStyle(document.body).backgroundColor,
        }));
        const pass = before.theme === 'hiru' && after.theme === 'yoru' && before.bg !== after.bg;
        record('C. Toggle hiru→yoru cambia bg', pass, `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`, t0);
      } catch (e: any) {
        record('C. Toggle hiru→yoru cambia bg', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

  } finally {
    await browser.close();
  }

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
