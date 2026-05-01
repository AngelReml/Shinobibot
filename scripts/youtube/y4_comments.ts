import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  const scroll = getTool('browser_scroll');
  if (!search || !scroll) process.exit(1);
  
  let target = '';
  try {
    const urls = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_video_urls.json', 'utf-8'));
    if (urls.length > 0) target = urls[0];
  } catch {}
  
  if (!target) {
    target = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  }
  
  const log: any[] = [];
  
  const nav = await search.execute({ query: target });
  log.push({ step: 'navigate', success: nav.success });
  
  // Scroll fuerte para cargar comentarios (YouTube los carga lazy)
  const scrollResult = await scroll.execute({
    url_contains: 'youtube.com/watch',
    scroll_count: 5,
    scroll_pixels: 1500,
    wait_between_ms: 2000
  });
  log.push({ step: 'scroll_for_comments', success: scrollResult.success });
  
  const body = (scrollResult.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
  
  const commentSectionMarkers = [
    /(\d+(?:[,.]\d+)*)\s*(?:Comments|Comentarios)/i,
    /Sort\s+by/i,
    /(?:Newest|Top)\s+comments/i
  ];
  
  let commentSectionStart = -1;
  for (const p of commentSectionMarkers) {
    const m = body.match(p);
    if (m && m.index !== undefined && (commentSectionStart === -1 || m.index < commentSectionStart)) {
      commentSectionStart = m.index;
    }
  }
  
  const commentsRegion = commentSectionStart >= 0 ? body.substring(commentSectionStart, commentSectionStart + 6000) : '';
  const authorMatches = Array.from(commentsRegion.matchAll(/@([a-zA-Z0-9._-]+)/g)).map(m => m[1]);
  const uniqueAuthors = Array.from(new Set(authorMatches)).slice(0, 50);
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y4_comments.json', JSON.stringify({
    body_length: body.length,
    comment_section_found: commentSectionStart >= 0,
    comment_section_offset: commentSectionStart,
    unique_commenters_detected: uniqueAuthors,
    commenter_count: uniqueAuthors.length,
    comments_region_preview: commentsRegion.substring(0, 2000)
  }, null, 2));
  console.log(`Y4: section_found=${commentSectionStart >= 0} | commenters=${uniqueAuthors.length} | body=${body.length}`);
}

main().catch(e => { console.error('Y4 ERROR:', e.message); process.exit(1); });
