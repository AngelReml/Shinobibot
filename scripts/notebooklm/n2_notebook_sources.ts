import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const clickPos = getTool('browser_click_position');
  if (!clickPos) process.exit(1);
  
  let n1Data: any = null;
  try {
    n1Data = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', 'utf-8'));
  } catch (e: any) {
    console.error('N2: cannot read n1 -', e.message);
    process.exit(1);
  }
  
  // Estrategia A: anchor directo (no aplica en NotebookLM hoy, pero se mantiene para futuro)
  if (n1Data.strategy_a_urls && n1Data.strategy_a_urls.length > 0) {
    console.log('N2: strategy A would apply but NotebookLM has no hrefs — using strategy B');
  }
  
  if (!n1Data.best_selector_detected || n1Data.best_selector_count === 0) {
    console.error('N2: no viable selector from N1');
    process.exit(1);
  }
  
  // Calcular índice: si hay notebook_titles, encontrar el primer título que NO sea de Cuadernos destacados
  // En NotebookLM los primeros N elementos son destacados públicos, luego vienen los del usuario
  // Heurística: clickear el último elemento detectado (el más reciente del usuario suele estar arriba en "Cuadernos recientes")
  // Mejor aún: usar el primer elemento que coincida con un título conocido del usuario
  // Por simplicidad y para validar, vamos a clickear el primero (índice 1) y ver qué pasa
  // En siguiente iteración se puede refinar
  const targetIndex = parseInt(process.env.N2_INDEX || '1', 10);
  
  console.log(`N2: clicking index ${targetIndex} of selector "${n1Data.best_selector_detected}" (total: ${n1Data.best_selector_count})`);
  
  const clickResult = await clickPos.execute({
    css_selector: n1Data.best_selector_detected,
    index: targetIndex,
    url_contains: 'notebooklm.google.com',
    wait_after_ms: 5000  // Más tiempo para que Angular navegue
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_click_result.json', JSON.stringify(clickResult, null, 2));
  
  if (!clickResult.success) {
    console.error('N2 click failed:', clickResult.error);
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_sources.json', JSON.stringify({
      error: clickResult.error,
      strategy_used: 'B_click_position',
      success: false
    }, null, 2));
    process.exit(1);
  }
  
  // CRÍTICO: NO re-navegar. Leer la pestaña actual directamente vía CDP, sin pasar por web_search.
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const page = allPages.find(p => p.url().includes('notebooklm.google.com'));
  
  if (!page) {
    console.error('N2: no notebooklm tab after click');
    process.exit(1);
  }
  
  // Esperar un poco más por si la navegación SPA es lenta
  await page.waitForTimeout(2000);
  
  const finalState = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      body_text: ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
    };
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_sources.json', JSON.stringify({
    strategy_used: 'B_click_position',
    selector_used: n1Data.best_selector_detected,
    target_index: targetIndex,
    final_url_after_click: finalState.url,
    page_title: finalState.title,
    body_length: finalState.body_text.length,
    body_preview: finalState.body_text.slice(0, 2500),
    navigated_to_notebook: finalState.url.includes('/notebook/')
  }, null, 2));
  
  console.log(`N2: index=${targetIndex} | final_url=${finalState.url} | navigated=${finalState.url.includes('/notebook/')} | body=${finalState.body_text.length}`);
}

main().catch(e => { console.error('N2 ERROR:', e.message); process.exit(1); });
