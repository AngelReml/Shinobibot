// test_browser_engine.ts
//
// Bloque 2 — E2E hermético del motor browser. Lanza su propio Chromium
// bundled (no asume Comet/Chrome abierto) y ejerce las nuevas capacidades.
//
// Uso:
//   npx tsx test_browser_engine.ts
//   SHINOBI_TEST_HEADED=1 npx tsx test_browser_engine.ts   # ver browser

import { chromium } from 'playwright';
import * as fs from 'fs';
import {
  applyStealth,
  getAccessibilityTree,
  screenshot,
  cleanExtract,
} from './src/tools/browser_engine.js';

interface TestResult { name: string; pass: boolean; detail: string; ms: number; }

const results: TestResult[] = [];
const headed = process.env.SHINOBI_TEST_HEADED === '1';

function record(name: string, pass: boolean, detail: string, t0: number): void {
  const ms = Date.now() - t0;
  results.push({ name, pass, detail, ms });
  const tag = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag} [${ms}ms] ${name} — ${detail}`);
}

async function main(): Promise<void> {
  console.log(`[test] Launching bundled Chromium (headed=${headed})…`);
  const browser = await chromium.launch({ headless: !headed });

  try {
    // ─── Test D: stealth (navigator.webdriver === undefined) ───────────────
    {
      const t0 = Date.now();
      try {
        const ctx = await browser.newContext();
        await applyStealth(ctx);
        const page = await ctx.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const wd = await page.evaluate(() => (navigator as any).webdriver);
        const langs = await page.evaluate(() => Array.from((navigator as any).languages || []).join(','));
        await ctx.close();
        const pass = wd === undefined && langs.includes('es');
        record('D. applyStealth', pass, `navigator.webdriver=${wd}, navigator.languages=${langs}`, t0);
      } catch (e: any) {
        record('D. applyStealth', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── Test A: accessibility tree on example.com ─────────────────────────
    {
      const t0 = Date.now();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const tree = await getAccessibilityTree(page);
        await ctx.close();
        // example.com renders "Example Domain" + a link ("Learn more" or
        // "More information" depending on revision). We just check that the
        // tree contains the title role/heading and at least one link.
        const hasHeading = /heading.*Example Domain/i.test(tree.text);
        const hasLink = /\blink\b/.test(tree.text);
        const hasElements = tree.element_count > 2;
        const pass = hasHeading && hasLink && hasElements;
        record('A. getAccessibilityTree(example.com)', pass,
          `elements=${tree.element_count}, has heading=${hasHeading}, has link=${hasLink}, truncated=${tree.truncated}`,
          t0);
      } catch (e: any) {
        record('A. getAccessibilityTree(example.com)', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── Test B: screenshot on example.com (>5 KB, file exists) ────────────
    {
      const t0 = Date.now();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        const shot = await screenshot(page);
        await ctx.close();
        const exists = fs.existsSync(shot.path);
        const sizeOk = shot.bytes > 5 * 1024;
        const pass = exists && sizeOk;
        record('B. screenshot(example.com)', pass,
          `path=${shot.path}, bytes=${shot.bytes}, exists=${exists}`,
          t0);
      } catch (e: any) {
        record('B. screenshot(example.com)', false, `threw: ${e.message}`, t0);
      }
    }

    // ─── Test C: cleanExtract on news.ycombinator.com ──────────────────────
    {
      const t0 = Date.now();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const r = await cleanExtract(page);
        await ctx.close();
        const titleOk = /Hacker News/i.test(r.title);
        const contentOk = r.char_count > 500;
        const linksOk = r.links.length > 20;
        const pass = titleOk && contentOk && linksOk;
        record('C. cleanExtract(news.ycombinator.com)', pass,
          `title="${r.title}", content_chars=${r.char_count}, links=${r.links.length}, images=${r.images.length}`,
          t0);
      } catch (e: any) {
        record('C. cleanExtract(news.ycombinator.com)', false, `threw: ${e.message}`, t0);
      }
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
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  process.exit(2);
});
