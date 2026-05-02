import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('C:/Users/angel/Desktop/shinobibot/artifacts/antibot', { recursive: true });

async function main() {
  const tool = getTool('web_search_with_warmup');
  if (!tool) process.exit(1);
  
  const r = await tool.execute({
    query: 'https://www.upwork.com/nx/search/jobs/?q=web%20scraping',
    max_retries: 3,
    backoff_base_ms: 5000
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/antibot/upwork_warmup_raw.json', JSON.stringify(r, null, 2));
  
  const stdout = r.output || '';
  const blockDetected = /just a moment|cloudflare|cf-please-wait|attention required|captcha/i.test(stdout);
  const traceMatch = stdout.match(/--- ANTIBOT TRACE ---([\s\S]+?)$/);
  
  console.log(`UPWORK WARMUP: success=${r.success} | block_in_final=${blockDetected} | output_chars=${stdout.length}`);
  if (traceMatch) console.log(`TRACE:\n${traceMatch[1].slice(0, 1500)}`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
