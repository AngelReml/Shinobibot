import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const URL = 'https://notebooklm.google.com';

async function main() {
  const search = getTool('web_search');
  if (!search) { console.error('web_search missing'); process.exit(1); }
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_raw.json', JSON.stringify(r, null, 2));
  
  // NotebookLM URLs de notebooks individuales: notebooklm.google.com/notebook/<id>
  const notebookUrls = Array.from(new Set((r.output.match(/https:\/\/notebooklm\.google\.com\/notebook\/[a-z0-9-]+/gi) || [])));
  
  // Extraer body para detectar títulos visibles
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', JSON.stringify({
    page_title: title,
    notebook_urls: notebookUrls,
    notebook_count: notebookUrls.length,
    body_preview: body.substring(0, 2000)
  }, null, 2));
  console.log(`N1: notebooks=${notebookUrls.length} | title="${title}"`);
}

main().catch(e => { console.error('N1 ERROR:', e.message); process.exit(1); });
