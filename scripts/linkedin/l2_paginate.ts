import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

async function main() {
  const click = getTool('browser_click');
  if (!click) { console.error('browser_click missing'); process.exit(1); }
  
  const allProfiles = new Set<string>();
  const pageOutputs: any[] = [];
  
  for (let page = 2; page <= 4; page++) {
    const r = await click.execute({ button_text: 'Next', url_contains: 'linkedin.com/search', wait_after_ms: 4000 });
    pageOutputs.push({ page, success: r.success, error: r.error });
    if (!r.success) break;
    const urls = (r.output.match(/https:\/\/www\.linkedin\.com\/in\/[a-z0-9-]+/gi) || []);
    urls.forEach(u => allProfiles.add(u));
  }
  
  const list = Array.from(allProfiles);
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l2_paginated_profiles.json', JSON.stringify(list, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l2_page_attempts.json', JSON.stringify(pageOutputs, null, 2));
  console.log(`L2: ${list.length} profiles after paginating ${pageOutputs.filter(p=>p.success).length}/${pageOutputs.length} pages`);
}

main().catch(e => { console.error('L2 ERROR:', e.message); process.exit(1); });
