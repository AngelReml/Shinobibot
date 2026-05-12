// test_bloque8_3.ts
//
// Bloque 8.3 — E2E hermético de antesala + chat Stitch.
// Cubre:
//   A. Antesala carga: #antesala visible, SVG presente, papel renderizado
//   B. sessionStorage shinobiEntered=true → antesala oculta, chat visible directo
//   C. WebSocket conecta y procesa send → final (con conv-ID)
//   D. Toggle hiru→yoru cambia data-theme + bg

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-8-3-'));
process.env.APPDATA = sandbox;
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Bypass del onboarding gate
const shinobiDir = path.join(sandbox, 'Shinobi');
fs.mkdirSync(shinobiDir, { recursive: true });
fs.writeFileSync(path.join(shinobiDir, 'config.json'), JSON.stringify({
  opengravity_api_key: 'test', opengravity_url: 'https://test.example/api',
  language: 'es', memory_path: path.join(shinobiDir, 'memory'),
  onboarded_at: new Date().toISOString(), version: '2.0.0',
}));

// Mock LLM
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
    // ─── A. Antesala carga fresh ─────────────────────────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#antesala', { timeout: 5000 });
        const data = await page.evaluate(() => {
          const a = document.getElementById('antesala');
          const mark = document.getElementById('antesala-mark');
          const chat = document.getElementById('chat-app');
          const bg = a ? getComputedStyle(a).backgroundColor : '';
          return {
            antesalaVisible: a && !a.classList.contains('hidden'),
            markPresent: !!mark && mark.getAttribute('src') === '/assets/shinobi-mark.png',
            antesalaBg: bg,
            chatHidden: chat && (chat.style.opacity === '0' || chat.style.opacity === ''),
            theme: document.documentElement.getAttribute('data-theme'),
          };
        });
        // bg debe ser negro puro
        const isBlack = /rgb\(\s*0,\s*0,\s*0\s*\)/.test(data.antesalaBg);
        const pass = !!data.antesalaVisible && data.markPresent && isBlack && data.theme === 'hiru';
        record('A. Antesala carga fresh (negro + mark)', pass, JSON.stringify(data), t0);
      } catch (e: any) {
        record('A. Antesala carga fresh', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

    // ─── B. sessionStorage shinobiEntered=true salta antesala ────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        // Setear sessionStorage ANTES del navigate. Como sessionStorage es per-origin,
        // hacemos un goto previo a una página vacía para tener origen, luego setear,
        // luego goto al index real.
        await page.goto(`http://127.0.0.1:${PORT}/onboarding.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => sessionStorage.setItem('shinobiEntered', 'true'));
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const data = await page.evaluate(() => {
          const a = document.getElementById('antesala');
          const chat = document.getElementById('chat-app');
          return {
            antesalaHidden: a && a.classList.contains('hidden'),
            chatVisible: chat && chat.style.opacity === '1',
            convsActive: !!(window as any).ShinobiConvs?.getActive?.(),
          };
        });
        const pass = !!data.antesalaHidden && !!data.chatVisible;
        record('B. shinobiEntered=true salta antesala', pass, JSON.stringify(data), t0);
      } catch (e: any) {
        record('B. shinobiEntered=true salta antesala', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

    // ─── C. WS conecta + send → final ────────────────────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/onboarding.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => sessionStorage.setItem('shinobiEntered', 'true'));
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
        record('C. WS conecta + send → final', pass, `agentMsg="${data.agentMsg.slice(0, 80)}"`, t0);
      } catch (e: any) {
        record('C. WS conecta + send → final', false, `threw: ${e.message}`, t0);
      } finally { await ctx.close(); }
    }

    // ─── D. Toggle hiru→yoru cambia bg + data-theme ─────────────────────
    {
      const t0 = Date.now();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/onboarding.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => sessionStorage.setItem('shinobiEntered', 'true'));
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
        record('D. Toggle hiru→yoru cambia bg', pass, `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`, t0);
      } catch (e: any) {
        record('D. Toggle hiru→yoru cambia bg', false, `threw: ${e.message}`, t0);
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
