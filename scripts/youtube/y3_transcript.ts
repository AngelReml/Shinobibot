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
  
  if (!target) target = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  
  const log: any[] = [];
  
  const nav = await search.execute({ query: target });
  log.push({ step: 'navigate', success: nav.success, url: target });
  
  // Click "Más acciones" / "More actions" — probar ambos idiomas
  const moreLabels = ['Más acciones', 'More actions', 'Más opciones', 'More options'];
  let moreOpened = false;
  for (const label of moreLabels) {
    if (moreOpened) break;
    const r = await click.execute({
      aria_label: label,
      url_contains: 'youtube.com/watch',
      wait_after_ms: 1500
    });
    log.push({ step: `click_more_aria_${label}`, success: r.success, error: r.error });
    if (r.success) moreOpened = true;
  }
  
  // Si no, intentar con CSS selector amplio para botón de menú dentro del player
  if (!moreOpened) {
    const r = await click.execute({
      css_selector: 'ytd-menu-renderer button[aria-haspopup]',
      url_contains: 'youtube.com/watch',
      wait_after_ms: 1500
    });
    log.push({ step: 'click_more_css_menu_renderer', success: r.success, error: r.error });
    if (r.success) moreOpened = true;
  }
  
  // Click "Mostrar transcripción" / "Show transcript"
  const transcriptLabels = ['Mostrar transcripción', 'Show transcript', 'Transcripción', 'Transcript'];
  let transcriptOpened = false;
  for (const label of transcriptLabels) {
    if (transcriptOpened) break;
    const r = await click.execute({
      aria_label: label,
      url_contains: 'youtube.com/watch',
      wait_after_ms: 2500
    });
    log.push({ step: `click_transcript_aria_${label}`, success: r.success, error: r.error });
    if (r.success) transcriptOpened = true;
  }
  
  // Fallback: button_text con varios idiomas
  if (!transcriptOpened) {
    for (const txt of ['transcripción', 'transcript', 'Mostrar transcripción']) {
      if (transcriptOpened) break;
      const r = await click.execute({
        button_text: txt,
        url_contains: 'youtube.com/watch',
        wait_after_ms: 2500
      });
      log.push({ step: `click_transcript_text_${txt}`, success: r.success, error: r.error });
      if (r.success) transcriptOpened = true;
    }
  }
  
  // Scroll para cargar todas las líneas
  if (transcriptOpened) {
    const s = await scroll.execute({
      url_contains: 'youtube.com/watch',
      scroll_count: 3,
      wait_between_ms: 1000
    });
    log.push({ step: 'scroll_transcript', success: s.success });
  }
  
  // Re-leer
  let transcriptText = '';
  let lines: string[] = [];
  if (transcriptOpened) {
    const re = await search.execute({ query: target });
    const body = (re.output.match(/--- BODY TEXT \([^)]+\) ---\n([\s\S]+?)\n\n---/) || [])[1] || '';
    lines = body.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s+\S[^\n]{0,200}/g) || [];
    transcriptText = lines.join('\n');
    log.push({ step: 'extract_transcript', lines_found: lines.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript.txt', transcriptText || '[NO TRANSCRIPT EXTRACTED]');
  console.log(`Y3: more_opened=${moreOpened} | transcript_opened=${transcriptOpened} | lines=${lines.length}`);
}

main().catch(e => { console.error('Y3 ERROR:', e.message); process.exit(1); });
