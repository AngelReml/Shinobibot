import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const KEYWORD = 'web scraping python';
const URL = `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(KEYWORD)}&sort=recency`;

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u1_raw.json', JSON.stringify(r, null, 2));
  
  // Upwork job URLs: /jobs/<slug>_~<id>/  o  /nx/jobs/<slug>~<id>
  const jobUrls = Array.from(new Set((r.output.match(/https:\/\/[a-z.]*upwork\.com\/(?:nx\/)?jobs?\/[a-z0-9_~-]+/gi) || [])));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u1_job_urls.json', JSON.stringify(jobUrls, null, 2));
  console.log(`U1: ${jobUrls.length} unique job URLs extracted from search "${KEYWORD}"`);
}

main().catch(e => { console.error('U1 ERROR:', e.message); process.exit(1); });
