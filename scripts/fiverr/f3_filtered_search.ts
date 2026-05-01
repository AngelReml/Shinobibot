import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

// Fiverr usa query params para filtros: pricing_factor, seller_level, delivery_time
const KEYWORD = 'web scraping python';
const URL = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(KEYWORD)}&seller_level=top_rated_seller%2Clevel_two_seller&price_buckets=1`;

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f3_raw.json', JSON.stringify(r, null, 2));
  
  const gigUrls = Array.from(new Set((r.output.match(/https:\/\/[a-z.]*fiverr\.com\/[a-z0-9_-]+\/[a-z0-9-]{8,}/gi) || [])));
  const finalUrl = (r.output.match(/Final URL: ([^\n]+)/) || [])[1] || '';
  const filtersHonored = finalUrl.includes('seller_level') && finalUrl.includes('price_buckets');
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f3_filtered.json', JSON.stringify({
    requested_url: URL,
    final_url: finalUrl,
    filters_honored_in_url: filtersHonored,
    gig_count: gigUrls.length,
    gig_urls: gigUrls
  }, null, 2));
  console.log(`F3: filters_in_url=${filtersHonored} | gigs=${gigUrls.length}`);
}

main().catch(e => { console.error('F3 ERROR:', e.message); process.exit(1); });
