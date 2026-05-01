import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const scroll = getTool('browser_scroll');
  if (!scroll) process.exit(1);
  
  // Verificar pestaña existente en youtube/watch
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const ytPage = allPages.find(p => p.url().includes('youtube.com/watch'));
  
  if (!ytPage) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
      error: 'NO YOUTUBE WATCH TAB OPEN',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('Y4: no youtube.com/watch tab open');
    process.exit(1);
  }
  
  console.log(`Y4: found youtube tab at ${ytPage.url()}`);
  
  // Scroll fuerte para cargar comentarios (lazy)
  const sc = await scroll.execute({
    url_contains: 'youtube.com/watch',
    scroll_count: 6,
    scroll_pixels: 1500,
    wait_between_ms: 2000
  });
  
  const body = (sc.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  
  const markers = [
    /(\d+(?:[,.]\d+)*)\s*(?:Comments|Comentarios)/i,
    /Sort\s+by/i,
    /Ordenar\s+por/i,
    /(?:Newest|Top|Más recientes|Principales)\s+comment/i
  ];
  let start = -1;
  for (const p of markers) {
    const m = body.match(p);
    if (m && m.index !== undefined && (start === -1 || m.index < start)) start = m.index;
  }
  
  const region = start >= 0 ? body.substring(start, start + 6000) : '';
  const authors = Array.from(region.matchAll(/@([a-zA-Z0-9._-]+)/g)).map(m => m[1]);
  const unique = Array.from(new Set(authors)).slice(0, 50);
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
    body_length: body.length,
    comment_section_found: start >= 0,
    comment_section_offset: start,
    unique_commenters_detected: unique,
    commenter_count: unique.length,
    comments_region_preview: region.substring(0, 2000)
  }, null, 2));
  console.log(`Y4: section_found=${start >= 0} | commenters=${unique.length} | body=${body.length}`);
}

main().catch(e => { console.error('Y4 ERROR:', e.message); process.exit(1); });
