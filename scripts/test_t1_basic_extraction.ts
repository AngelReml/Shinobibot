import { chromium } from 'playwright';
import '../src/tools/index.js';
import { getTool } from '../src/tools/tool_registry.js';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('C:/Users/angel/Desktop/shinobibot/artifacts/eje_b_validation', { recursive: true });

async function main() {
  const tool = getTool('web_search');
  if (!tool) { console.error('web_search not found'); process.exit(1); }
  const result = await tool.execute({ query: 'https://example.com' });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/eje_b_validation/t1_output.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
