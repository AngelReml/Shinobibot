import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  const click = getTool('browser_click');
  if (!search || !click) process.exit(1);
  
  let target = '';
  try {
    const urls = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y1_video_urls.json', 'utf-8'));
    if (urls.length > 0) target = urls[0];
  } catch {}
  
  if (!target) {
    target = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // first ever YouTube video, has captions
  }
  
  const log: any[] = [];
  
  // Asegurar navegación a la URL del vídeo
  const nav = await search.execute({ query: target });
  log.push({ step: 'navigate', success: nav.success, error: nav.error, url: target });
  
  // Estrategia A — clic en "more" / "..." luego "transcript"
  const moreClick = await click.execute({
    button_text: 'more',
    url_contains: 'youtube.com/watch',
    wait_after_ms: 2000
  });
  log.push({ step: 'click_more', success: moreClick.success, error: moreClick.error });
  
  const transcriptClick = await click.execute({
    button_text: 'transcript',
    url_contains: 'youtube.com/watch',
    wait_after_ms: 3000
  });
  log.push({ step: 'click_transcript', success: transcriptClick.success, error: transcriptClick.error });
  
  let transcriptText = '';
  if (transcriptClick.success) {
    // Re-navegar a la misma URL para forzar re-extracción del DOM ya con transcript abierto
    const reread = await search.execute({ query: target });
    const body = (reread.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    
    // Buscar líneas de transcript: típicamente "0:00 texto" o "00:12 texto"
    const transcriptLines = body.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s+[A-Za-zÁ-ÿ0-9]/g) || [];
    transcriptText = transcriptLines.join('\n');
    log.push({ step: 'extract_transcript_lines', count: transcriptLines.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript.txt', transcriptText || '[NO TRANSCRIPT EXTRACTED]');
  console.log(`Y3: transcript_lines=${transcriptText.split('\n').filter(l => l.length > 0).length} | strategy_A_success=${transcriptClick.success}`);
}

main().catch(e => { console.error('Y3 ERROR:', e.message); process.exit(1); });
