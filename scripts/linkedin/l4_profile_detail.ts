import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  // Coge primera URL de l1_profiles.json o usa una pública conocida
  let target = '';
  try {
    const profiles = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l1_profiles.json', 'utf-8'));
    if (profiles.length > 0) target = profiles[0];
  } catch {}
  
  if (!target) {
    console.error('L4: no profile URL available from L1');
    process.exit(1);
  }
  
  const r = await search.execute({ query: target });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l4_profile_raw.json', JSON.stringify(r, null, 2));
  
  // Heurística simple: extraer título de la página y primer párrafo del body
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  const bodyMatch = r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/);
  const body = bodyMatch ? bodyMatch[1] : '';
  const firstSentences = body.split('.').slice(0, 5).join('.');
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/linkedin/l4_extracted.json', JSON.stringify({
    target_url: target,
    page_title: title,
    body_preview: firstSentences,
    body_length: body.length
  }, null, 2));
  console.log(`L4: profile ${target} | title="${title}" | body_chars=${body.length}`);
}

main().catch(e => { console.error('L4 ERROR:', e.message); process.exit(1); });
