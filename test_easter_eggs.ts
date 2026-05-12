// test_easter_eggs.ts
// Verifica que cada mecánica oculta funciona realmente desde el browser.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-easter-'));
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
(orchModule.ShinobiOrchestrator as any).process = async (t: string) => ({ response: `Eco: ${t}` });

const { startWebServer } = await import('./src/web/server.js');
const PORT = 14401;
await startWebServer({ port: PORT, dbPath: path.join(sandbox, 'web_chat.db') });
await new Promise(r => setTimeout(r, 250));

interface TestResult { name: string; pass: boolean; detail: string; }
const results: TestResult[] = [];
function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} ${name} — ${detail}`);
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(`[browser-error] ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        console.log(`[browser-${m.type()}] ${m.text()}`);
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as any).ShinobiConvs?.getActive?.(), { timeout: 5000 });
    await page.waitForTimeout(250);

    // ─── 1. /zen activa modo zen ────────────────────────────────────────
    {
      await page.click('#composer');
      await page.keyboard.type('/zen');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      const data = await page.evaluate(() => ({
        zen: document.body.classList.contains('zen'),
        composerVal: (document.getElementById('composer') as HTMLTextAreaElement).value,
        toast: !!document.querySelector('.egg-toast'),
      }));
      record('1a. /zen + Enter activa zen', data.zen && data.composerVal === '', JSON.stringify(data));

      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const out = await page.evaluate(() => document.body.classList.contains('zen'));
      record('1b. Esc sale de zen', !out, `zen-after-esc=${out}`);
      await page.waitForTimeout(800);
    }

    // ─── 2. Konami → sensei mode ────────────────────────────────────────
    {
      // Click fuera del composer para que la secuencia no termine como texto
      await page.click('body', { position: { x: 400, y: 50 } });
      await page.waitForTimeout(100);
      const keys = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
      for (const k of keys) await page.keyboard.press(k);
      await page.waitForTimeout(400);
      const data = await page.evaluate(() => ({
        sensei: document.body.classList.contains('sensei'),
        rain: !!document.getElementById('sensei-rain'),
        kanjiCount: document.querySelectorAll('.sensei-kanji').length,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      }));
      record('2. Konami → modo sensei', data.sensei && data.rain && data.kanjiCount > 20, JSON.stringify(data));

      // Cleanup para no contaminar siguientes tests
      await page.evaluate(() => {
        document.body.classList.remove('sensei');
        const r = document.getElementById('sensei-rain');
        if (r) r.remove();
        const stack = document.getElementById('egg-toast-stack');
        if (stack) stack.innerHTML = '';
      });
    }

    // ─── 3. Haiku detection ─────────────────────────────────────────────
    {
      await page.fill('#composer', '');
      await page.click('#composer');
      await page.keyboard.type('Antes del primer trazo');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('el pincel sueña con tinta');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('todo aún es posible');
      await page.waitForTimeout(200);
      const data = await page.evaluate(() => {
        const c = document.getElementById('composer') as HTMLTextAreaElement;
        const cs = getComputedStyle(c);
        return {
          hasClass: c.classList.contains('haiku-mode'),
          val: c.value,
          lineCount: c.value.split('\n').length,
          font: cs.fontFamily,
          align: cs.textAlign,
          fontStyle: cs.fontStyle,
        };
      });
      record('3. Haiku detection (3 líneas)', data.hasClass && data.lineCount === 3, JSON.stringify(data));
      await page.fill('#composer', '');
      await page.waitForTimeout(100);
    }

    // ─── 4. 7-click logo → shu-ha-ri ───────────────────────────────────
    {
      await page.evaluate(() => {
        const t = document.getElementById('egg-toast-stack');
        if (t) t.innerHTML = '';
      });
      const initialUrl = page.url();
      const logo = page.locator('.brand-shinobi-img');
      for (let i = 0; i < 7; i++) {
        await logo.click({ delay: 30 });
      }
      await page.waitForTimeout(400);
      const data = await page.evaluate(() => {
        const stack = document.getElementById('egg-toast-stack');
        if (!stack) return { hasToast: false };
        const t = stack.querySelector('.egg-toast');
        return {
          hasToast: !!t,
          kanji: t?.querySelector('.egg-kanji')?.textContent || '',
          text: t?.querySelector('.egg-text')?.textContent || '',
        };
      });
      const navigated = page.url() !== initialUrl;
      const kanjiIsShuHaRi = ['守','破','離'].includes(data.kanji);
      record('4. 7 clicks → shu-ha-ri (sin navegar)', !!data.hasToast && kanjiIsShuHaRi && !navigated,
        JSON.stringify({ ...data, navigated, url: page.url() }));
    }

    // ─── 5. Cheat sheet (Ctrl+/) ───────────────────────────────────────
    {
      // Limpiar antes
      await page.evaluate(() => {
        const m = document.getElementById('cheat-modal');
        if (m) m.remove();
      });
      await page.keyboard.press('Control+/');
      await page.waitForTimeout(350);
      const data = await page.evaluate(() => {
        const m = document.getElementById('cheat-modal');
        return {
          modal: !!m,
          open: !!m?.classList.contains('open'),
          hasTitle: !!m?.querySelector('.cheat-title'),
        };
      });
      record('5. Ctrl+/ abre cheat sheet', data.modal && data.open && data.hasTitle, JSON.stringify(data));
      if (data.modal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }

    // ─── 6. Hanko presente con transition ──────────────────────────────
    {
      await page.fill('#composer', 'hola desde test');
      await page.click('#send-btn');
      await page.waitForFunction(() => {
        const msgs = document.querySelectorAll('.chat-feed .msg.agent');
        return msgs.length > 0 && !msgs[msgs.length - 1].classList.contains('pending');
      }, undefined, { timeout: 5000 });
      await page.waitForTimeout(1500);
      const data = await page.evaluate(() => {
        const h = document.querySelector('.chat-feed .msg.agent .hanko');
        if (!h) return { present: false };
        const cs = getComputedStyle(h);
        return {
          present: true,
          transition: cs.transition,
          hasTransform: cs.transition.includes('transform'),
        };
      });
      record('6. Hanko presente con transition rotate', !!data.present && !!data.hasTransform, JSON.stringify(data));
    }

    // ─── 7. dojo-quiet se quita con mousemove ───────────────────────────
    {
      await page.evaluate(() => document.body.classList.add('dojo-quiet'));
      await page.waitForTimeout(120);
      const before = await page.evaluate(() => document.body.classList.contains('dojo-quiet'));
      await page.mouse.move(500, 400);
      await page.mouse.move(700, 500);
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => document.body.classList.contains('dojo-quiet'));
      record('7. mousemove remueve dojo-quiet', before && !after, `before=${before}, after=${after}`);
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('═════════════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} mechanics work`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);
  console.log('═════════════════════════════════════════════════════');

  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
