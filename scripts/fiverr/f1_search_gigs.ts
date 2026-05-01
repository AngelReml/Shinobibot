import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const KEYWORD = 'pdf to json ocr';
const URL = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(KEYWORD)}`;

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f1_raw.json', JSON.stringify(r, null, 2));
  
  const gigUrls = Array.from(new Set((r.output.match(/https:\/\/www\.fiverr\.com\/[a-z0-9_-]+\/[a-z0-9-]{8,}/gi) || [])));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/fiverr/f1_gig_urls.json', JSON.stringify(gigUrls, null, 2));
  console.log(`F1: ${gigUrls.length} unique gig URLs extracted from search "${KEYWORD}"`);
}

main().catch(e => { console.error('F1 ERROR:', e.message); process.exit(1); });
