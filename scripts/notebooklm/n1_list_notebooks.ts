import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

const URL = 'https://notebooklm.google.com';

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_raw.json', JSON.stringify(r, null, 2));
  
  // Estrategia A: regex sobre output crudo (lo que ya hacíamos)
  const notebookUrlsA = Array.from(new Set((r.output.match(/https:\/\/notebooklm\.google\.com\/notebook\/[a-z0-9-]+/gi) || [])));
  
  // Estrategia B: inspeccionar DOM directamente con Playwright
  // En SPAs los notebook cards suelen ser <div role="button"> o tener data-testid
  let notebookCardsInventory: any = { error: 'not collected' };
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    const pages = contexts.flatMap(c => c.pages());
    const page = pages.find(p => p.url().includes('notebooklm.google.com'));
    
    if (page) {
      notebookCardsInventory = await page.evaluate(() => {
        // Probamos varios selectores típicos de SPAs Google
        const candidates: any[] = [];
        const selectors = [
          'a[href*="/notebook/"]',
          '[role="button"][aria-label]',
          'div[data-testid*="notebook" i]',
          'button[aria-label*="notebook" i]',
          'mat-card',
          '.notebook-card',
          '[role="listitem"]'
        ];
        const result: any = {};
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length === 0) continue;
          const items = [];
          for (let i = 0; i < els.length && items.length < 30; i++) {
            const el = els[i] as HTMLElement;
            const text = (el.innerText || el.textContent || '').trim().slice(0, 200);
            const aria = el.getAttribute('aria-label') || '';
            const href = el.getAttribute('href') || '';
            if (text || aria || href) {
              items.push({ index: i, text, aria_label: aria, href });
            }
          }
          if (items.length > 0) result[sel] = { count: els.length, items };
        }
        return result;
      });
    } else {
      notebookCardsInventory = { error: 'no notebooklm tab found' };
    }
  } catch (e: any) {
    notebookCardsInventory = { error: e.message };
  }
  
  // Identificar el selector más prometedor (el que tiene más items con texto razonable)
  let bestSelector = '';
  let bestCount = 0;
  for (const [sel, data] of Object.entries(notebookCardsInventory)) {
    if (typeof data === 'object' && data && 'count' in (data as any)) {
      const count = (data as any).count;
      if (count > bestCount && count < 100) { // sanity: si hay >100 elementos no es notebook cards
        bestCount = count;
        bestSelector = sel;
      }
    }
  }
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', JSON.stringify({
    page_title: title,
    strategy_a_url_count: notebookUrlsA.length,
    strategy_a_urls: notebookUrlsA,
    strategy_b_dom_inventory: notebookCardsInventory,
    best_selector_detected: bestSelector,
    best_selector_count: bestCount,
    body_preview: body.substring(0, 2000)
  }, null, 2));
  console.log(`N1: urls_in_html=${notebookUrlsA.length} | best_selector="${bestSelector}" | count=${bestCount}`);
}

main().catch(e => { console.error('N1 ERROR:', e.message); process.exit(1); });
