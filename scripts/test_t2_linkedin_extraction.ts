import '../src/tools/index.js';
import { getTool } from '../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

async function main() {
  const tool = getTool('web_search');
  if (!tool) { console.error('web_search not found'); process.exit(1); }
  const result = await tool.execute({
    query: 'https://www.linkedin.com/search/results/people/?keywords=excess%20and%20surplus%20lines%20broker'
  });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/eje_b_validation/t2_output.json', JSON.stringify(result, null, 2));
  
  const profileLinks = (result.output.match(/\/in\/[a-z0-9-]+/gi) || []);
  const unique = Array.from(new Set(profileLinks.map(l => l.toLowerCase())));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/eje_b_validation/t2_profile_links.json', JSON.stringify(unique, null, 2));
  console.log(`Extracted ${unique.length} unique profile links`);
  console.log(unique.join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
