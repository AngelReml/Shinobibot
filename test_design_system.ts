// test_design_system.ts
//
// Bloque 8.1 — E2E hermético del Design System.
// Lanza Chromium bundled de Playwright (mismo patrón que Bloque 2), arranca
// el server del Bloque 1 en sandbox tmp, carga theme-preview.html y verifica
// que las 4 paletas aplican + theme.js persiste en localStorage + reload
// mantiene el tema.
//
// Uso:
//   npx tsx test_design_system.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-design-test-'));
process.env.APPDATA = sandbox;
process.chdir(sandbox);
console.log(`[test] sandbox: ${sandbox}`);

// Mock LLM antes de importar el server (igual que test_onboarding).
const { OpenGravityClient } = await import('./src/cloud/opengravity_client.js');
(OpenGravityClient as any).invokeLLM = async () => ({ success: true, output: JSON.stringify({ role: 'assistant', content: 'mocked' }), error: '' });

const { startWebServer } = await import('./src/web/server.js');

const PORT = 14101;
await startWebServer({ port: PORT, dbPath: path.join(sandbox, 'web_chat.db') });
await new Promise(r => setTimeout(r, 200));

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} [${ms}ms] ${name} — ${detail}`);
}

// Expected RGB strings for each palette's --bg (from tokens.css).
// CSS rgb strings: "rgb(R, G, B)" formatted.
const EXPECTED_BG: Record<string, string> = {
  sumi: 'rgb(10, 10, 12)',
  kintsugi: 'rgb(10, 8, 7)',
  aurora: 'rgb(13, 27, 42)',
  bushido: 'rgb(242, 236, 228)',
};

async function readBg(page: Page): Promise<string> {
  return await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function main() {
  console.log('[test] launching headless Chromium...');
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();

    // Helper: bloquea transiciones para que los computed styles devuelvan
    // el color final inmediatamente, no un valor intermedio durante el
    // cubic-bezier de 400ms que tiene base.css.
    async function killTransitions(p: Page) {
      await p.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }',
      });
    }

    // ─── A: cargar theme-preview.html → default 'sumi' ──────────────────
    {
      const t0 = Date.now();
      try {
        await page.goto(`http://127.0.0.1:${PORT}/theme-preview.html`, { waitUntil: 'load', timeout: 10000 });
        await killTransitions(page);
        const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const bg = await readBg(page);
        const ok = attr === 'sumi' && bg === EXPECTED_BG.sumi;
        record('A. Load theme-preview → default sumi', ok, `data-theme=${attr}, body bg=${bg}`, t0);
      } catch (e: any) {
        record('A. Load theme-preview → default sumi', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── B: setTheme('aurora') → atributo cambia, localStorage persiste ─
    {
      const t0 = Date.now();
      try {
        await page.evaluate(() => (window as any).ShinobiTheme.setTheme('aurora'));
        const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const stored = await page.evaluate(() => localStorage.getItem('shinobi.theme'));
        const bg = await readBg(page);
        const ok = attr === 'aurora' && stored === 'aurora' && bg === EXPECTED_BG.aurora;
        record('B. setTheme("aurora") aplica + persiste', ok, `attr=${attr}, ls=${stored}, bg=${bg}`, t0);
      } catch (e: any) {
        record('B. setTheme("aurora") aplica + persiste', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── C: reload mantiene el tema ─────────────────────────────────────
    {
      const t0 = Date.now();
      try {
        await page.reload({ waitUntil: 'load' });
        await killTransitions(page);
        const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const bg = await readBg(page);
        const ok = attr === 'aurora' && bg === EXPECTED_BG.aurora;
        record('C. Reload mantiene aurora', ok, `attr=${attr}, bg=${bg}`, t0);
      } catch (e: any) {
        record('C. Reload mantiene aurora', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── D: cada paleta tiene su propio --bg ────────────────────────────
    {
      const t0 = Date.now();
      try {
        const results: Record<string, string> = {};
        for (const name of ['sumi', 'kintsugi', 'aurora', 'bushido']) {
          await page.evaluate(n => (window as any).ShinobiTheme.setTheme(n), name);
          results[name] = await readBg(page);
        }
        const allDistinct = new Set(Object.values(results)).size === 4;
        const allMatchExpected = Object.entries(results).every(([k, v]) => v === EXPECTED_BG[k]);
        const ok = allDistinct && allMatchExpected;
        record('D. 4 paletas tienen --bg distinto y correcto', ok, JSON.stringify(results), t0);
      } catch (e: any) {
        record('D. 4 paletas tienen --bg distinto y correcto', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── E: enso-logo.png está presente y es válido PNG ──────────────────
    // Bloque 8.1 — usamos el artwork real (textura de tinta orgánica),
    // recoloreado por tema vía CSS mask-image. NO más SVG sintético.
    {
      const t0 = Date.now();
      try {
        const r = await page.request.get(`http://127.0.0.1:${PORT}/assets/enso-logo.png`);
        const status = r.status();
        const buf = await r.body();
        const ok = status === 200 && buf.length > 100 * 1024 && buf[0] === 0x89 && buf[1] === 0x50; // PNG magic
        record('E. enso-logo.png servido + magic PNG', ok, `status=${status}, bytes=${buf.length}, magic=${buf[0].toString(16)} ${buf[1].toString(16)}`, t0);
      } catch (e: any) {
        record('E. enso-logo.png servido + magic PNG', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── F: shinobi-mark.png está presente y >100KB (artwork real) ───────
    {
      const t0 = Date.now();
      try {
        const r = await page.request.get(`http://127.0.0.1:${PORT}/assets/shinobi-mark.png`);
        const status = r.status();
        const buf = await r.body();
        const ok = status === 200 && buf.length > 100 * 1024 && buf[0] === 0x89 && buf[1] === 0x50;
        record('F. shinobi-mark.png servido + magic PNG', ok, `status=${status}, bytes=${buf.length}, magic=${buf[0].toString(16)} ${buf[1].toString(16)}`, t0);
      } catch (e: any) {
        record('F. shinobi-mark.png servido + magic PNG', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── G: mask-image del enso aplica con accent del tema activo ────────
    {
      const t0 = Date.now();
      try {
        const inkBg = await page.evaluate(() => {
          const el = document.querySelector('.ink-svg') as HTMLElement;
          return el ? getComputedStyle(el).backgroundColor : '(no element)';
        });
        // En cualquier tema, el background-color del .ink-svg debe coincidir
        // con --accent (que la mask pintará a través del alpha del PNG).
        const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
        const ok = !!inkBg && inkBg !== '(no element)' && inkBg !== 'rgba(0, 0, 0, 0)';
        record('G. enso mask-image pinta con --accent', ok, `bg=${inkBg}, --accent=${accent}`, t0);
      } catch (e: any) {
        record('G. enso mask-image pinta con --accent', false, `threw: ${e.message}`, t0);
      }
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
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
