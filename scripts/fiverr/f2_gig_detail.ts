import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  let target = '';
  try {
    const urls = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f1_gig_urls.json', 'utf-8'));
    if (urls.length > 0) target = urls[0];
  } catch {}
  
  if (!target) {
    console.error('F2: no gig URL from F1');
    process.exit(1);
  }
  
  const r = await search.execute({ query: target });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f2_gig_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  const priceMatches = Array.from(new Set((body.match(/(?:US\$|\$|EUR|€)\s?\d{1,5}(?:[.,]\d{2})?/gi) || [])));
  const reviewCount = (body.match(/(\d+(?:[,.]\d+)?)\s*(?:reviews|valoraciones|opiniones)/i) || [])[1] || null;
  const ratingMatch = body.match(/(\d\.\d)\s*(?:\(|out of|de)/i);
  const rating = ratingMatch ? ratingMatch[1] : null;
  
  const summary = {
    target_url: target,
    page_title: title,
    body_length: body.length,
    prices_detected: priceMatches,
    review_count: reviewCount,
    rating,
    body_preview: body.substring(0, 800)
  };
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f2_extracted.json', JSON.stringify(summary, null, 2));
  console.log(`F2: gig=${target} title="${title}" body=${body.length} prices=${priceMatches.length} reviews=${reviewCount} rating=${rating}`);
}

main().catch(e => { console.error('F2 ERROR:', e.message); process.exit(1); });
