import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  const clickPos = getTool('browser_click_position');
  if (!search || !clickPos) process.exit(1);
  
  let n1Data: any = null;
  try {
    n1Data = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', 'utf-8'));
  } catch (e: any) {
    console.error('N2: cannot read n1 -', e.message);
    process.exit(1);
  }
  
  // Estrategia A: si N1 encontró URLs en HTML, usar la primera
  let target = '';
  if (n1Data.strategy_a_urls && n1Data.strategy_a_urls.length > 0) {
    target = n1Data.strategy_a_urls[0];
    const r = await search.execute({ query: target });
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_notebook_raw.json', JSON.stringify(r, null, 2));
    
    const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
    
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_sources.json', JSON.stringify({
      strategy_used: 'A_direct_url',
      notebook_url: target,
      page_title: title,
      body_length: body.length,
      body_preview: body.substring(0, 2500)
    }, null, 2));
    console.log(`N2: strategy=A | notebook=${target} | body=${body.length}`);
    return;
  }
  
  // Estrategia B: si N1 detectó un selector con cards, clickar el primero
  if (n1Data.best_selector_detected && n1Data.best_selector_count > 0) {
    const clickResult = await clickPos.execute({
      css_selector: n1Data.best_selector_detected,
      index: 1,
      url_contains: 'notebooklm.google.com',
      wait_after_ms: 4000
    });
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_click_result.json', JSON.stringify(clickResult, null, 2));
    
    if (!clickResult.success) {
      console.error('N2 strategy B click failed:', clickResult.error);
      process.exit(1);
    }
    
    // Re-leer la página tras click
    const reread = await search.execute({ query: 'https://notebooklm.google.com' });
    const body = (reread.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    const finalUrl = (reread.output.match(/Final URL: ([^\n]+)/) || [])[1] || '';
    const title = (reread.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
    
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_notebook_raw.json', JSON.stringify(reread, null, 2));
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n2_sources.json', JSON.stringify({
      strategy_used: 'B_click_position',
      selector_used: n1Data.best_selector_detected,
      final_url_after_click: finalUrl,
      page_title: title,
      body_length: body.length,
      body_preview: body.substring(0, 2500)
    }, null, 2));
    console.log(`N2: strategy=B | final_url=${finalUrl} | body=${body.length}`);
    return;
  }
  
  console.error('N2: neither strategy A nor B viable');
  process.exit(1);
}

main().catch(e => { console.error('N2 ERROR:', e.message); process.exit(1); });
