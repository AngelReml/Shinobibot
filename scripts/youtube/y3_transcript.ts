import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const search = getTool('web_search');
  const click = getTool('browser_click');
  const scroll = getTool('browser_scroll');
  if (!search || !click || !scroll) { console.error('missing tools'); process.exit(1); }
  
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
  log.push({ step: 'navigate', success: nav.success, url: target });
  
  // Estrategia nueva: clickar por aria-label "More actions" (SVG button)
  const moreClick = await click.execute({
    aria_label: 'More actions',
    url_contains: 'youtube.com/watch',
    wait_after_ms: 2000
  });
  log.push({ step: 'click_more_aria', success: moreClick.success, error: moreClick.error });
  
  // Si no encontró "More actions", intentar selector CSS típico de YouTube
  if (!moreClick.success) {
    const cssClick = await click.execute({
      css_selector: 'button[aria-label*="more" i]',
      url_contains: 'youtube.com/watch',
      wait_after_ms: 2000
    });
    log.push({ step: 'click_more_css', success: cssClick.success, error: cssClick.error });
  }
  
  // Click "Show transcript" / "Mostrar transcripción" — buscar por aria-label o texto
  let transcriptOpened = false;
  const transcriptAria = await click.execute({
    aria_label: 'Show transcript',
    url_contains: 'youtube.com/watch',
    wait_after_ms: 3000
  });
  log.push({ step: 'click_transcript_aria', success: transcriptAria.success, error: transcriptAria.error });
  transcriptOpened = transcriptAria.success;
  
  if (!transcriptOpened) {
    const transcriptText = await click.execute({
      button_text: 'transcript',
      url_contains: 'youtube.com/watch',
      wait_after_ms: 3000
    });
    log.push({ step: 'click_transcript_text', success: transcriptText.success, error: transcriptText.error });
    transcriptOpened = transcriptText.success;
  }
  
  // Scroll para cargar todas las líneas del transcript
  if (transcriptOpened) {
    const scrollResult = await scroll.execute({
      url_contains: 'youtube.com/watch',
      scroll_count: 3,
      wait_between_ms: 1000
    });
    log.push({ step: 'scroll_transcript', success: scrollResult.success });
  }
  
  // Re-leer la página para extraer el transcript
  let transcriptText = '';
  let transcriptLines: string[] = [];
  if (transcriptOpened) {
    const reread = await search.execute({ query: target });
    const body = (reread.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    transcriptLines = body.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s+[A-Za-zÁ-ÿ0-9][^\n]{0,200}/g) || [];
    transcriptText = transcriptLines.join('\n');
    log.push({ step: 'extract_transcript', lines_found: transcriptLines.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript.txt', transcriptText || '[NO TRANSCRIPT EXTRACTED]');
  console.log(`Y3: transcript_opened=${transcriptOpened} | lines=${transcriptLines.length} | first_line="${transcriptLines[0] || 'N/A'}"`);
}

main().catch(e => { console.error('Y3 ERROR:', e.message); process.exit(1); });
