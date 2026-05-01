import '../../src/tools/index.js';
import { getTool } from '../../src/tools/tool_registry.js';
import { readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';

const QUESTION = 'Resume el contenido principal del notebook en 3 frases.';

async function main() {
  let target = '';
  try {
    const data = JSON.parse(readFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n1_notebooks.json', 'utf-8'));
    if (data.notebook_urls && data.notebook_urls.length > 0) target = data.notebook_urls[0];
  } catch {}
  
  if (!target) {
    console.error('N3: no notebook URL');
    process.exit(1);
  }
  
  const log: any[] = [];
  
  // Paso 1: navegar y asegurar que estamos en la pestaña del notebook
  const search = getTool('web_search');
  if (!search) process.exit(1);
  const nav = await search.execute({ query: target });
  log.push({ step: 'navigate', success: nav.success, error: nav.error });
  
  // Paso 2: usar Playwright directo para la interacción de texto
  // browser_click no permite escribir, asi que conectamos por CDP y operamos
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    const pages = contexts.flatMap(c => c.pages());
    const page = pages.find(p => p.url().includes('notebooklm.google.com/notebook'));
    
    if (!page) {
      log.push({ step: 'find_page', success: false, error: 'no notebooklm tab found' });
      writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
      process.exit(1);
    }
    
    log.push({ step: 'find_page', success: true, url: page.url() });
    
    // Paso 3: localizar el textarea del chat — heurística amplia
    const textareaSelectors = [
      'textarea[aria-label*="question" i]',
      'textarea[aria-label*="pregunt" i]',
      'textarea[placeholder*="question" i]',
      'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="pregunt" i]',
      'textarea',
      '[contenteditable="true"]'
    ];
    
    let typed = false;
    for (const sel of textareaSelectors) {
      try {
        const el = await page.locator(sel).first();
        if (await el.count() === 0) continue;
        await el.click({ timeout: 3000 });
        await el.fill(QUESTION, { timeout: 3000 });
        log.push({ step: 'type_question', selector_used: sel, success: true });
        typed = true;
        break;
      } catch (e: any) {
        log.push({ step: 'type_question_attempt', selector: sel, success: false, error: e.message });
      }
    }
    
    if (!typed) {
      writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
      console.log('N3: could not find textarea');
      process.exit(0);
    }
    
    // Paso 4: enviar (Enter o botón Send)
    let sent = false;
    try {
      await page.keyboard.press('Enter');
      log.push({ step: 'send_enter', success: true });
      sent = true;
    } catch (e: any) {
      log.push({ step: 'send_enter', success: false, error: e.message });
    }
    
    if (!sent) {
      writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
      process.exit(0);
    }
    
    // Paso 5: esperar respuesta — heurística: la respuesta aparece como nuevo bloque en el body
    await page.waitForTimeout(15000);
    
    const finalBody = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
    const trimmed = finalBody.length > 12000 ? finalBody.slice(0, 12000) + '...[truncated]' : finalBody;
    
    // Heurística para detectar respuesta: buscar el texto de la pregunta en el body y ver qué viene después
    const qIdx = trimmed.indexOf(QUESTION);
    const afterQuestion = qIdx >= 0 ? trimmed.substring(qIdx + QUESTION.length, qIdx + QUESTION.length + 3000) : '';
    
    log.push({ step: 'extract_answer', body_length: finalBody.length, question_found_in_body: qIdx >= 0, answer_length: afterQuestion.length });
    
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_answer.txt', afterQuestion || trimmed);
    console.log(`N3: answered=${afterQuestion.length > 0} | answer_chars=${afterQuestion.length} | body_total=${finalBody.length}`);
  } catch (err: any) {
    log.push({ step: 'fatal', error: err.message });
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
    console.error('N3 ERROR:', err.message);
  }
}

main().catch(e => { console.error('N3 ERROR:', e.message); process.exit(1); });
