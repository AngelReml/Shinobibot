import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('C:/Users/angel/Desktop/shinobibot/artifacts/antibot', { recursive: true });

async function main() {
  const tool = getTool('web_search_with_warmup');
  if (!tool) { console.error('tool missing'); process.exit(1); }
  
  const r = await tool.execute({
    query: 'https://www.fiverr.com/categories/programming-tech',
    max_retries: 3,
    backoff_base_ms: 5000
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/antibot/fiverr_warmup_raw.json', JSON.stringify(r, null, 2));
  
  const stdout = r.output || '';
  const blockDetected = /it needs a human touch|pxcr\d+|captcha/i.test(stdout);
  const traceMatch = stdout.match(/--- ANTIBOT TRACE ---([\s\S]+?)$/);
  
  console.log(`FIVERR WARMUP: success=${r.success} | block_in_final=${blockDetected} | output_chars=${stdout.length}`);
  if (traceMatch) console.log(`TRACE:\n${traceMatch[1].slice(0, 1500)}`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
