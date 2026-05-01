import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const KEYWORD = 'wholesale insurance broker';
const URL = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(KEYWORD)}`;

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l1_raw.json', JSON.stringify(r, null, 2));
  
  const profileUrls = Array.from(new Set((r.output.match(/https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+/gi) || [])));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l1_profiles.json', JSON.stringify(profileUrls, null, 2));
  console.log(`L1: ${profileUrls.length} unique profile URLs extracted`);
}

main().catch(e => { console.error('L1 ERROR:', e.message); process.exit(1); });
