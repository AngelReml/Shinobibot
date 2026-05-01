import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const log: any[] = [];
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const page = allPages.find(p => p.url().includes('youtube.com/watch'));
  
  if (!page) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify({
      error: 'NO YOUTUBE WATCH TAB',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('Y3: pestaña debe estar en youtube.com/watch');
    process.exit(1);
  }
  
  log.push({ step: 'find_page', url: page.url() });
  
  // Scroll inicial pequeño para asegurar que el botón "Más acciones" del player es visible
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(1500);
  
  // Click en la descripción para expandirla (necesario para ver el botón de transcripción)
  let descriptionExpanded = false;
  try {
    // Intentar varios selectores para expandir la descripción (...más o el contenedor)
    const expandSelectors = ['tp-yt-paper-button#expand', '#expand', '#description-inner', '.description-inline-expander'];
    for (const sel of expandSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.click({ timeout: 3000 });
        descriptionExpanded = true;
        log.push({ step: 'expand_description', success: true, selector: sel });
        break;
      }
    }
  } catch (e: any) {
    log.push({ step: 'expand_description_error', error: e.message });
  }

  await page.waitForTimeout(1500);

  // Intentar abrir la transcripción con búsqueda agresiva
  let transcriptOpened = false;
  
  // 1. Intentar por selectores conocidos
  const transcriptSelectors = [
    'ytd-video-description-transcript-section-renderer button',
    '#primary-button button',
    'ytd-button-renderer.ytd-video-description-transcript-section-renderer button'
  ];

  for (const sel of transcriptSelectors) {
    if (transcriptOpened) break;
    try {
      const btn = page.locator(sel).filter({ visible: true }).first();
      if (await btn.count() > 0) {
        await btn.click({ timeout: 5000 });
        transcriptOpened = true;
        log.push({ step: 'click_transcript_selector', success: true, selector: sel });
      }
    } catch (e: any) {
      log.push({ step: 'click_transcript_selector_error', selector: sel, error: e.message });
    }
  }

  // 2. Intentar por texto/aria-label dinámico si no funcionó
  if (!transcriptOpened) {
    try {
      const allButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('ytd-video-description-transcript-section-renderer button, #description button'));
        return btns.map((b: any) => ({
          text: b.innerText || '',
          aria: b.getAttribute('aria-label') || '',
          visible: b.offsetWidth > 0
        }));
      });
      log.push({ step: 'debug_description_buttons', buttons: allButtons });

      const labels = ['Mostrar transcripción', 'Show transcript', 'Transcripción', 'Transcript'];
      for (const label of labels) {
        if (transcriptOpened) break;
        const btn = page.getByText(label, { exact: false }).filter({ visible: true }).first();
        if (await btn.count() > 0) {
          await btn.click({ timeout: 5000 });
          transcriptOpened = true;
          log.push({ step: 'click_transcript_text', success: true, label });
        }
      }
    } catch (e: any) {
      log.push({ step: 'click_transcript_text_error', error: e.message });
    }
  }

  // Si no se abrió, intentar el método anterior del menú "Más acciones"
  if (!transcriptOpened) {
    log.push({ step: 'fallback_to_more_actions' });
    // (Lógica previa de click_more si fuera necesaria, pero el subagent dice que está en la descripción)
  }
  
  if (!transcriptOpened) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify(log, null, 2));
    console.error('Y3: no se pudo abrir transcripción');
    process.exit(1);
  }
  
  // Scroll en el panel de transcripción para cargar todas las líneas
  await page.waitForTimeout(2000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const panel = document.querySelector('ytd-transcript-renderer, ytd-transcript-segment-list-renderer');
      if (panel) panel.scrollTop = panel.scrollHeight;
    });
    await page.waitForTimeout(800);
  }
  
  // Extraer líneas del transcript directamente del DOM (segmentos)
  const transcript = await page.evaluate(() => {
    const segs = document.querySelectorAll('ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer');
    const lines: string[] = [];
    for (const s of Array.from(segs)) {
      const tsEl = s.querySelector('.segment-timestamp, [class*="timestamp"]');
      const txEl = s.querySelector('.segment-text, yt-formatted-string.segment-text, [class*="segment-text"]');
      const ts = tsEl ? (tsEl.textContent || '').trim() : '';
      const tx = txEl ? (txEl.textContent || '').trim() : '';
      if (ts || tx) lines.push(`${ts} ${tx}`.trim());
    }
    return lines;
  });
  log.push({ step: 'extract_transcript_segments', count: transcript.length });
  
  // Fallback: si no se extrajeron segmentos por el selector específico, intentar regex sobre el body
  let finalLines = transcript;
  if (finalLines.length === 0) {
    const bodyText = await page.evaluate(() => ((document.body as any).innerText || ''));
    finalLines = bodyText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s+\S[^\n]{1,200}/g) || [];
    log.push({ step: 'fallback_regex_body', count: finalLines.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/youtube/y3_transcript.txt', finalLines.join('\n') || '[NO TRANSCRIPT]');
  console.log(`Y3: description_expanded=${descriptionExpanded} | transcript_opened=${transcriptOpened} | lines=${finalLines.length} | first="${(finalLines[0] || '').slice(0, 100)}"`);
}

main().catch(e => { console.error('Y3 ERROR:', e.message); process.exit(1); });
