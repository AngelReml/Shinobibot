import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';

const KEYWORD = 'data extraction';
// Upwork tiene query param ?t=... para filtros de tiempo. Probamos con last 24h
const URL = `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(KEYWORD)}&sort=recency&t=24`;

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  const r = await search.execute({ query: URL });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u3_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  
  // Detectar marcadores temporales típicos de Upwork: "Posted X minutes/hours ago", "Hace X horas"
  const timeMarkers: string[] = Array.from(new Set((body.match(/(?:Posted|Hace|Publicado)\s+(?:less than\s+)?(\d+)\s+(minute|min|hour|hora|horas|day|día|days|días|dia|dias|second|segundo|segundos)s?\s*(?:ago|atrás)?/gi) || [])));
  const jobUrls = Array.from(new Set((r.output.match(/https:\/\/[a-z.]*upwork\.com\/(?:nx\/)?jobs?\/[a-z0-9_~-]+/gi) || [])));
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/upwork/u3_recent.json', JSON.stringify({
    requested_url: URL,
    keyword: KEYWORD,
    time_markers_detected: timeMarkers,
    job_count: jobUrls.length,
    job_urls: jobUrls
  }, null, 2));
  console.log(`U3: time_markers=${timeMarkers.length} | jobs=${jobUrls.length}`);
}

main().catch(e => { console.error('U3 ERROR:', e.message); process.exit(1); });
