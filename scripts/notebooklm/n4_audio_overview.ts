import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const page = allPages.find(p => p.url().includes('notebooklm.google.com/notebook/'));
  
  if (!page) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_log.json', JSON.stringify({
      error: 'NO NOTEBOOK TAB OPEN',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('N4: pestaña debe estar dentro de un notebook');
    process.exit(1);
  }
  
  const inventory = await page.evaluate(() => {
    const result: any = {};
    
    // Keywords amplios en ES + EN
    const audioKeywords = ['audio', 'overview', 'resumen', 'generar', 'generate', 'play', 'reproducir', 'listen', 'escuchar', 'studio', 'podcast'];
    
    // Inventario 1: botones y elementos clickables con texto/aria-label que matcheen
    const allClickable = document.querySelectorAll('button, [role="button"], a');
    const audioButtons: any[] = [];
    for (let i = 0; i < allClickable.length; i++) {
      const el = allClickable[i] as HTMLElement;
      const text = (el.innerText || el.textContent || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      const combined = (text + ' ' + aria).toLowerCase();
      if (audioKeywords.some(k => combined.includes(k))) {
        audioButtons.push({
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 120),
          aria_label: aria.slice(0, 120),
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          classes: typeof el.className === 'string' ? el.className.slice(0, 100) : ''
        });
      }
    }
    result.audio_related_buttons = audioButtons;
    
    // Inventario 2: elementos <audio> y <video> ya cargados
    const mediaEls = document.querySelectorAll('audio, video');
    const mediaElements: any[] = [];
    for (let i = 0; i < mediaEls.length; i++) {
      const el = mediaEls[i] as HTMLMediaElement;
      mediaElements.push({
        tag: el.tagName.toLowerCase(),
        src: el.src || el.currentSrc || '',
        duration: el.duration || 0,
        paused: el.paused
      });
    }
    result.media_elements = mediaElements;
    
    // Inventario 3: URLs de audio en el HTML
    const html = document.documentElement.outerHTML;
    const audioUrls = (html.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|wav|ogg|opus|webm)[^\s"'<>]*/gi) || []).slice(0, 20);
    result.audio_urls_in_html = audioUrls;
    
    // Inventario 4: panel "Studio" o similar (NotebookLM tiene una columna lateral con Audio Overview)
    const studioMarkers = ['Studio', 'Audio Overview', 'Resumen de audio'];
    const markerHits: any[] = [];
    const bodyText = (document.body.innerText || '').toLowerCase();
    for (const m of studioMarkers) {
      if (bodyText.includes(m.toLowerCase())) markerHits.push(m);
    }
    result.studio_markers_in_body = markerHits;
    
    result.page_url = window.location.href;
    result.page_title = document.title;
    
    return result;
  });
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_audio_inventory.json', JSON.stringify(inventory, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_log.json', JSON.stringify({
    page: inventory.page_url,
    audio_buttons_count: inventory.audio_related_buttons.length,
    media_elements_count: inventory.media_elements.length,
    audio_urls_count: inventory.audio_urls_in_html.length,
    studio_markers: inventory.studio_markers_in_body
  }, null, 2));
  
  console.log(`N4: audio_buttons=${inventory.audio_related_buttons.length} | media=${inventory.media_elements.length} | audio_urls=${inventory.audio_urls_in_html.length} | studio_markers=${inventory.studio_markers_in_body.join(',')}`);
}

main().catch(e => { console.error('N4 ERROR:', e.message); process.exit(1); });
