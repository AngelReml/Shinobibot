import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';

async function main() {
  let target = '';
  try {
    const data = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', 'utf-8'));
    if (data.notebook_urls && data.notebook_urls.length > 0) target = data.notebook_urls[0];
  } catch {}
  
  if (!target) {
    console.error('N4: no notebook URL');
    process.exit(1);
  }
  
  const log: any[] = [];
  const search = getTool('web_search');
  if (!search) process.exit(1);
  
  await search.execute({ query: target });
  
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    const pages = contexts.flatMap(c => c.pages());
    const page = pages.find(p => p.url().includes('notebooklm.google.com/notebook'));
    
    if (!page) {
      log.push({ step: 'find_page', success: false });
      writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_log.json', JSON.stringify(log, null, 2));
      process.exit(0);
    }
    
    // Inventario completo del DOM relacionado con audio
    const inventory = await page.evaluate(() => {
      const result: any = {};
      
      // Buscar botones/elementos relacionados con audio
      const audioKeywords = ['audio', 'overview', 'resumen', 'generate', 'generar', 'play', 'reproducir', 'listen', 'escuchar'];
      const allButtons = document.querySelectorAll('button, [role="button"]');
      const audioButtons: any[] = [];
      for (let i = 0; i < allButtons.length; i++) {
        const el = allButtons[i];
        const text = ((el.innerText || el.textContent || '') + '').trim();
        const aria = el.getAttribute('aria-label') || '';
        const combined = (text + ' ' + aria).toLowerCase();
        if (audioKeywords.some(k => combined.includes(k))) {
          audioButtons.push({ text: text.slice(0, 100), aria: aria.slice(0, 100), tag: el.tagName.toLowerCase() });
        }
      }
      result.audio_related_buttons = audioButtons;
      
      // Buscar elementos <audio> o <video>
      const audioEls = document.querySelectorAll('audio, video');
      const mediaElements: any[] = [];
      for (let i = 0; i < audioEls.length; i++) {
        const el = audioEls[i] as HTMLMediaElement;
        mediaElements.push({
          tag: el.tagName.toLowerCase(),
          src: el.src || '',
          duration: el.duration || 0,
          paused: el.paused
        });
      }
      result.media_elements = mediaElements;
      
      // Buscar URLs de audio en el HTML
      const html = document.documentElement.outerHTML;
      const audioUrls = (html.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|wav|ogg|opus|webm)[^\s"'<>]*/gi) || []).slice(0, 20);
      result.audio_urls_in_html = audioUrls;
      
      result.page_title = document.title;
      result.page_url = window.location.href;
      
      return result;
    });
    
    log.push({ step: 'inventory', ...inventory });
    
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_audio_inventory.json', JSON.stringify(inventory, null, 2));
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_log.json', JSON.stringify(log, null, 2));
    console.log(`N4: audio_buttons=${inventory.audio_related_buttons.length} | media_elements=${inventory.media_elements.length} | audio_urls=${inventory.audio_urls_in_html.length}`);
  } catch (err: any) {
    log.push({ step: 'fatal', error: err.message });
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n4_log.json', JSON.stringify(log, null, 2));
    console.error('N4 ERROR:', err.message);
  }
}

main().catch(e => { console.error('N4 ERROR:', e.message); process.exit(1); });
