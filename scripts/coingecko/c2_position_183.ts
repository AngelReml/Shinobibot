import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  const click = getTool('browser_click');
  if (!search || !click) process.exit(1);
  
  const log: any[] = [];
  
  // ESTRATEGIA A: URL directa página 2
  const URL_A = 'https://www.coingecko.com/?page=2';
  const rA = await search.execute({ query: URL_A });
  log.push({ strategy: 'A_direct_url', success: rA.success, error: rA.error });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_strategy_a_raw.json', JSON.stringify(rA, null, 2));
  
  const bodyA = (rA.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  
  // Parsear ranks de página 2 (debería ser 101-200)
  const linePattern = /(\d{1,3})\s+([A-Z][A-Za-z0-9 .'\-]{1,40})\s+([A-Z]{2,10})\s+\$?([\d,.]+)/g;
  const rankedA: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = linePattern.exec(bodyA)) !== null) {
    const rank = parseInt(m[1], 10);
    if (rank >= 101 && rank <= 200) {
      rankedA.push({ rank, name: m[2].trim(), symbol: m[3], price_text: m[4] });
    }
  }
  
  const target183_A = rankedA.find(c => c.rank === 183);
  log.push({ strategy: 'A_results', ranks_extracted: rankedA.length, found_183: !!target183_A, coin_at_183: target183_A || null });
  
  // ESTRATEGIA B: paginar desde top con click "Next"
  let target183_B: any = null;
  if (!target183_A) {
    const navTop = await search.execute({ query: 'https://www.coingecko.com' });
    log.push({ strategy: 'B_navigate_top', success: navTop.success });
    
    const clickResult = await click.execute({ button_text: 'Next', url_contains: 'coingecko.com', wait_after_ms: 3000 });
    log.push({ strategy: 'B_click_next', success: clickResult.success, error: clickResult.error });
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_strategy_b_raw.json', JSON.stringify(clickResult, null, 2));
    
    if (clickResult.success) {
      const bodyB = (clickResult.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
      const rankedB: any[] = [];
      const re = /(\d{1,3})\s+([A-Z][A-Za-z0-9 .'\-]{1,40})\s+([A-Z]{2,10})\s+\$?([\d,.]+)/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(bodyB)) !== null) {
        const rank = parseInt(mm[1], 10);
        if (rank >= 101 && rank <= 200) {
          rankedB.push({ rank, name: mm[2].trim(), symbol: mm[3], price_text: mm[4] });
        }
      }
      target183_B = rankedB.find(c => c.rank === 183);
      log.push({ strategy: 'B_results', ranks_extracted: rankedB.length, found_183: !!target183_B, coin_at_183: target183_B || null });
    }
  }
  
  const final = target183_A || target183_B;
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_position_183.json', JSON.stringify({
    log,
    coin_at_position_183: final,
    found_via: target183_A ? 'A_direct_url' : (target183_B ? 'B_paginate_click' : null)
  }, null, 2));
  
  if (final) {
    console.log(`C2: position 183 = ${final.name} (${final.symbol}) — found via ${target183_A ? 'A' : 'B'}`);
  } else {
    console.log('C2: position 183 NOT FOUND with either strategy');
  }
}

main().catch(e => { console.error('C2 ERROR:', e.message); process.exit(1); });
