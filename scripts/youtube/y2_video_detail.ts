import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  let target = '';
  try {
    const urls = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_video_urls.json', 'utf-8'));
    if (urls.length > 0) target = urls[0];
  } catch {}
  
  if (!target) {
    // Fallback a un vídeo público estable si Y1 falló
    target = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }
  
  const r = await search.execute({ query: target });
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y2_video_raw.json', JSON.stringify(r, null, 2));
  
  const body = (r.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  const title = (r.output.match(/Page title: ([^\n]+)/) || [])[1] || '';
  
  // Heurísticas YouTube
  const viewsMatch = body.match(/([\d.,]+)\s*(?:views|visualizaciones|vistas)/i);
  const likesMatch = body.match(/([\d.,KMkm]+)\s*(?:likes|me gusta)/i);
  const datePatterns = [
    /(?:Published|Publicado|Estrenado|Premiered)(?:\s+on)?\s+([A-Za-zÁ-ÿ]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:Hace|Posted)\s+(\d+\s+(?:days?|weeks?|months?|years?|días?|semanas?|meses|años?)\s*(?:ago|atrás)?)/i,
    /(\d{1,2}\s+(?:de\s+)?[A-Za-zÁ-ÿ]+(?:\s+de)?\s+\d{4})/
  ];
  let dateFound = null;
  for (const p of datePatterns) {
    const m = body.match(p);
    if (m) { dateFound = m[1] || m[0]; break; }
  }
  
  // Subscriber count (canal)
  const subsMatch = body.match(/([\d.,KMkm]+)\s*(?:subscribers|suscriptores|seguidores)/i);
  
  const summary = {
    target_url: target,
    page_title: title,
    body_length: body.length,
    views: viewsMatch ? viewsMatch[1] : null,
    likes: likesMatch ? likesMatch[1] : null,
    date: dateFound,
    channel_subscribers: subsMatch ? subsMatch[1] : null,
    body_preview: body.substring(0, 1000)
  };
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y2_extracted.json', JSON.stringify(summary, null, 2));
  console.log(`Y2: video=${target} | title="${title}" | views=${summary.views} | date=${summary.date} | body=${body.length}`);
}

main().catch(e => { console.error('Y2 ERROR:', e.message); process.exit(1); });
