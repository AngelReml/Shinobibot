import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const URL = 'https://www.coingecko.com';

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c1_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  // CoinGecko URLs de coin individual: /en/coins/<slug> o /es/coins/<slug>
  const coinUrls = Array.from(new Set((r.output.match(/https:\/\/www\.coingecko\.com\/(?:en|es)\/coins\/[a-z0-9-]+/gi) || [])));
  
  // Heurística para parsear filas del top: rank + nombre + símbolo + precio
  // Patrón típico en CoinGecko: "1 Bitcoin BTC $XXXXX +Y% ..."
  const ranked: any[] = [];
  // Buscar bloques tipo "1\nBitcoin\nBTC\n$..." o todo en línea con espacios
  const linePattern = /(\d{1,3})\s+([A-Z][A-Za-z0-9 .'\-]{1,40})\s+([A-Z]{2,10})\s+\$?([\d,.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = linePattern.exec(body)) !== null && ranked.length < 50) {
    const rank = parseInt(m[1], 10);
    if (rank >= 1 && rank <= 200) {
      ranked.push({ rank, name: m[2].trim(), symbol: m[3], price_text: m[4] });
    }
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c1_top.json', JSON.stringify({
    page_title: title,
    body_length: body.length,
    coin_urls_found: coinUrls.length,
    coin_urls: coinUrls.slice(0, 30),
    ranked_extracted: ranked.length,
    ranked: ranked.slice(0, 30)
  }, null, 2));
  
  console.log(`C1: title="${title}" | coin_urls=${coinUrls.length} | ranked_rows=${ranked.length}`);
}

main().catch(e => { console.error('C1 ERROR:', e.message); process.exit(1); });
