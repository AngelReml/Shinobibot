import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const URL = 'https://www.coingecko.com/en/coins/bitcoin';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c3_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  // Heurísticas para Bitcoin page
  const priceMatch = body.match(/\$\s?([\d,]+(?:\.\d+)?)/);
  const marketCapMatch = body.match(/Market\s+Cap[\s:]*\$?\s?([\d,.]+\s*[KMBTkmbt]?)/i);
  const volumeMatch = body.match(/(?:24[\s-]?h\s+)?(?:Trading\s+)?Volume[\s:]*\$?\s?([\d,.]+\s*[KMBTkmbt]?)/i);
  const change24hMatch = body.match(/24h[^\d-]*([+-]?\d+\.\d+)\s?%/i);
  const athMatch = body.match(/(?:All[- ]Time\s+High|ATH)[\s:]*\$?\s?([\d,.]+)/i);
  const supplyMatch = body.match(/Circulating\s+Supply[\s:]*([\d,.]+)/i);
  
  const summary = {
    target_url: URL,
    page_title: title,
    body_length: body.length,
    price: priceMatch ? priceMatch[1] : null,
    market_cap: marketCapMatch ? marketCapMatch[1] : null,
    volume_24h: volumeMatch ? volumeMatch[1] : null,
    change_24h: change24hMatch ? change24hMatch[1] : null,
    ath: athMatch ? athMatch[1] : null,
    circulating_supply: supplyMatch ? supplyMatch[1] : null,
    body_preview: body.substring(0, 1000)
  };
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/coingecko/c3_bitcoin.json', JSON.stringify(summary, null, 2));
  console.log(`C3: title="${title}" | price=${summary.price} | mcap=${summary.market_cap} | ath=${summary.ath}`);
}

main().catch(e => { console.error('C3 ERROR:', e.message); process.exit(1); });
