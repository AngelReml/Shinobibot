import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const allPages = contexts.flatMap(c => c.pages());
  
  // Localizar pestaña de NotebookLM (cualquiera dentro del dominio)
  const page = allPages.find(p => p.url().includes('notebooklm.google.com'));
  
  if (!page) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', JSON.stringify({
      error: 'NO NOTEBOOKLM TAB OPEN',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('N1: no notebooklm tab open in Comet. User must open one manually.');
    process.exit(1);
  }
  
  console.log(`N1: found notebooklm tab at ${page.url()}`);
  
  // Inventario completo del DOM con varios selectores candidatos
  const inventory = await page.evaluate(() => {
    const selectors = [
      'a[href*="/notebook/"]',
      'mat-card',
      '[role="button"][aria-label]',
      'button[aria-label*="proyecto" i]',
      'button[aria-label*="notebook" i]',
      'div[role="button"]',
      '[data-testid*="notebook" i]',
      '[role="listitem"]'
    ];
    const result: any = {};
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length === 0) continue;
      const items = [];
      for (let i = 0; i < els.length && items.length < 30; i++) {
        const el = els[i];
        const text = (((el as any).innerText || el.textContent || '') + '').trim().slice(0, 200);
        const aria = el.getAttribute('aria-label') || '';
        const href = el.getAttribute('href') || '';
        if (text || aria || href) items.push({ index: i, text, aria_label: aria, href });
      }
      if (items.length > 0) result[sel] = { count: els.length, items };
    }
    return { current_url: window.location.href, page_title: document.title, selectors: result };
  });
  
  // Heurística para elegir mejor selector: preferir href, luego mat-card, luego role+aria
  let bestSelector = '';
  let bestCount = 0;
  let bestReason = '';
  
  // Prioridad 1: a[href*="/notebook/"] — si hay >0, es el ideal
  if (inventory.selectors['a[href*="/notebook/"]']) {
    bestSelector = 'a[href*="/notebook/"]';
    bestCount = inventory.selectors[bestSelector].count;
    bestReason = 'direct_anchor_with_href';
  } 
  // Prioridad 2: mat-card (Material UI tarjetas, típico en apps Google)
  else if (inventory.selectors['mat-card']) {
    bestSelector = 'mat-card';
    bestCount = inventory.selectors[bestSelector].count;
    bestReason = 'material_card';
  }
  // Prioridad 3: el selector con conteo razonable (3-50) y items con aria-label informativo
  else {
    for (const [sel, data] of Object.entries(inventory.selectors)) {
      const d = data as any;
      if (d.count >= 1 && d.count <= 50) {
        const hasInformativeAria = d.items.some((it: any) => it.aria_label && it.aria_label.length > 5);
        if (hasInformativeAria && d.count > bestCount) {
          bestSelector = sel;
          bestCount = d.count;
          bestReason = 'aria_label_informative';
        }
      }
    }
  }
  
  // Extraer URLs href si existen
  const hrefUrls = inventory.selectors['a[href*="/notebook/"]'] 
    ? (inventory.selectors['a[href*="/notebook/"]'] as any).items.map((it: any) => it.href).filter((h: string) => h)
    : [];
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', JSON.stringify({
    page_title: inventory.page_title,
    current_url: inventory.current_url,
    strategy_a_url_count: hrefUrls.length,
    strategy_a_urls: hrefUrls,
    strategy_b_dom_inventory: inventory.selectors,
    best_selector_detected: bestSelector,
    best_selector_count: bestCount,
    best_selector_reason: bestReason
  }, null, 2));
  
  console.log(`N1: tab=${page.url()} | href_urls=${hrefUrls.length} | best_selector="${bestSelector}" (${bestReason}) | count=${bestCount}`);
}

main().catch(e => { console.error('N1 ERROR:', e.message); process.exit(1); });
