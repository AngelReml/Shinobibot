import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const URL = 'https://www.coingecko.com/en/categories/decentralized-finance-defi';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c4_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  const coinUrls = Array.from(new Set((r.output.match(/https:\/\/www\.coingecko\.com\/(?:en|es)\/coins\/[a-z0-9-]+/gi) || [])));
  
  const linePattern = /(\d{1,3})\s+([A-Z][A-Za-z0-9 .'\-]{1,40})\s+([A-Z]{2,10})\s+\$?([\d,.]+)/g;
  const ranked: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = linePattern.exec(body)) !== null && ranked.length < 20) {
    const rank = parseInt(m[1], 10);
    if (rank >= 1 && rank <= 50) {
      ranked.push({ rank, name: m[2].trim(), symbol: m[3], price_text: m[4] });
    }
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c4_defi.json', JSON.stringify({
    category_url: URL,
    page_title: title,
    coin_urls_count: coinUrls.length,
    coin_urls_sample: coinUrls.slice(0, 15),
    ranked_count: ranked.length,
    ranked_top10: ranked.slice(0, 10)
  }, null, 2));
  
  console.log(`C4: defi_coins=${coinUrls.length} | ranked=${ranked.length}`);
}

main().catch(e => { console.error('C4 ERROR:', e.message); process.exit(1); });
