import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const TARGET_RANK = 183;

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  const log: any[] = [];
  
  const URL = 'https://www.coingecko.com/?page=2';
  const r = await search.execute({ query: URL });
  log.push({ step: 'navigate_page_2', success: r.success, error: r.error });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_strategy_a_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  
  // ESTRATEGIA NUEVA: dividir el body en tokens y buscar el rank objetivo
  // El rank suele aparecer aislado o pegado al nombre. Buscar "183" como token aislado y ver qué viene después.
  const rankPattern = new RegExp(`(?:^|[^\\d])${TARGET_RANK}(?:[^\\d]|$)`, 'g');
  const matches: { idx: number; context: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rankPattern.exec(body)) !== null) {
    matches.push({
      idx: m.index,
      context: body.substring(Math.max(0, m.index - 30), Math.min(body.length, m.index + 200))
    });
  }
  log.push({ step: 'rank_token_search', occurrences: matches.length });
  
  // Para cada ocurrencia del número 183, intentar extraer el coin asociado
  // Patrón típico CoinGecko: rank, luego (a veces tras espacios/saltos) nombre + símbolo + precio
  const candidates: any[] = [];
  for (const match of matches) {
    const after = match.context.substring(match.context.indexOf(String(TARGET_RANK)) + String(TARGET_RANK).length);
    
    // Buscar nombre+símbolo en los siguientes 200 chars
    // Patrón: nombre en mayúscula + símbolo en MAYÚSCULAS (2-10 chars)
    const namePattern = /([A-Z][A-Za-z0-9 .'\-]{1,40})\s+([A-Z]{2,10})/;
    const nm = after.match(namePattern);
    
    // Buscar precio
    const priceMatch = after.match(/\$\s?([\d,.]+)/);
    
    if (nm) {
      candidates.push({
        rank: TARGET_RANK,
        name: nm[1].trim(),
        symbol: nm[2],
        price: priceMatch ? priceMatch[1] : null,
        context_excerpt: match.context.substring(0, 250)
      });
    }
  }
  log.push({ step: 'candidate_extraction', candidates_found: candidates.length });
  
  // Tomar el primer candidato que parezca válido (símbolo razonable, no es STR/INT/PRICE/MARKET etc)
  const SYMBOL_BLACKLIST = ['USD', 'BTC', 'ETH', 'INT', 'STR', 'KEY', 'API', 'URL', 'DOM', 'SVG', 'CSS'];
  const valid = candidates.find(c => !SYMBOL_BLACKLIST.includes(c.symbol) && c.symbol.length >= 2 && c.symbol.length <= 8);
  
  const final = valid || candidates[0] || null;
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c2_position_183.json', JSON.stringify({
    target_rank: TARGET_RANK,
    log,
    coin_at_position_183: final,
    all_candidates: candidates
  }, null, 2));
  
  if (final) {
    console.log(`C2: rank ${TARGET_RANK} = ${final.name} (${final.symbol}) | price=${final.price}`);
  } else {
    console.log(`C2: rank ${TARGET_RANK} NOT FOUND. ${candidates.length} candidates with no clear match.`);
  }
}

main().catch(e => { console.error('C2 ERROR:', e.message); process.exit(1); });
