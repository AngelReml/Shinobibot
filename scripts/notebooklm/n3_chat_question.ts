import { writeFileSync } from 'fs';
import { chromium } from 'playwright';

const QUESTION = 'Resume el contenido principal del notebook en 3 frases.';

async function main() {
  const log: any[] = [];
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const allPages = browser.contexts().flatMap(c => c.pages());
  const page = allPages.find(p => p.url().includes('notebooklm.google.com/notebook/'));
  
  if (!page) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify({
      error: 'NO NOTEBOOK TAB OPEN — must be inside a notebook',
      open_tabs: allPages.map(p => p.url())
    }, null, 2));
    console.error('N3: pestaña debe estar dentro de un notebook (/notebook/<id>)');
    process.exit(1);
  }
  
  log.push({ step: 'find_page', url: page.url(), success: true });
  
  // Inventario inicial: encontrar el input del chat
  const inputInventory = await page.evaluate(() => {
    const candidates: any[] = [];
    
    // Selectores típicos de inputs de chat en SPAs Google/Material
    const selectors = [
      'textarea[aria-label*="pregunt" i]',
      'textarea[aria-label*="question" i]',
      'textarea[placeholder*="pregunt" i]',
      'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="haz" i]',
      'textarea',
      '[contenteditable="true"]',
      'div[role="textbox"]'
    ];
    
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length === 0) continue;
      const items = [];
      for (let i = 0; i < els.length && i < 5; i++) {
        const el = els[i] as HTMLElement;
        items.push({
          tag: el.tagName.toLowerCase(),
          aria_label: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          text: (el.innerText || el.textContent || '').slice(0, 80),
          visible: el.offsetWidth > 0 && el.offsetHeight > 0
        });
      }
      candidates.push({ selector: sel, count: els.length, samples: items });
    }
    
    return candidates;
  });
  
  log.push({ step: 'input_inventory', candidates: inputInventory });
  
  // Elegir primer selector visible que sea un textarea o contenteditable
  let chosenSelector = '';
  for (const cand of inputInventory) {
    const visibleSample = cand.samples.find((s: any) => s.visible);
    if (visibleSample) {
      chosenSelector = cand.selector;
      log.push({ step: 'selector_chosen', selector: chosenSelector, reason: 'first_visible_input' });
      break;
    }
  }
  
  if (!chosenSelector) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
    console.error('N3: no input field found in notebook page');
    process.exit(1);
  }
  
  // Escribir la pregunta
  let typed = false;
  try {
    const locator = page.locator(chosenSelector).filter({ visible: true }).first();
    await locator.click({ timeout: 5000 });
    await locator.fill(QUESTION, { timeout: 5000 });
    typed = true;
    log.push({ step: 'type_question', success: true, question: QUESTION });
  } catch (e: any) {
    log.push({ step: 'type_question', success: false, error: e.message });
  }
  
  if (!typed) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
    console.error('N3: could not type into input');
    process.exit(1);
  }
  
  // Capturar el body justo antes de enviar — para luego diff
  const bodyBefore = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
  log.push({ step: 'body_before_send', length: bodyBefore.length });
  
  // Enviar con Enter
  let sent = false;
  try {
    await page.keyboard.press('Enter');
    sent = true;
    log.push({ step: 'send_enter', success: true });
  } catch (e: any) {
    log.push({ step: 'send_enter', success: false, error: e.message });
  }
  
  if (!sent) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
    process.exit(1);
  }
  
  // Esperar respuesta del modelo. NotebookLM tarda 5-30s típicamente.
  // Estrategia: poll cada 3s hasta 45s, comparando longitud del body
  let answer = '';
  const startTime = Date.now();
  const maxWaitMs = 90000;  // hasta 90s, NotebookLM puede tardar
  const stabilityWindowMs = 6000;  // body estable durante 6s = respuesta terminada
  const pollIntervalMs = 2000;
  
  let lastBodyLength = bodyBefore.length;
  let lastChangeTime = Date.now();
  let everGrew = false;
  
  // Indicadores de "todavía está pensando" — si están presentes, NO terminar aún
  const thinkingIndicators = ['Pensando...', 'Thinking...', 'Processing material...', 'Procesando'];
  
  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(pollIntervalMs);
    const bodyNow = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
    
    if (bodyNow.length !== lastBodyLength) {
      lastBodyLength = bodyNow.length;
      lastChangeTime = Date.now();
      if (bodyNow.length > bodyBefore.length + 50) everGrew = true;
    }
    
    const stableFor = Date.now() - lastChangeTime;
    const stillThinking = thinkingIndicators.some(ind => bodyNow.includes(ind));
    
    log.push({
      step: 'poll',
      elapsed_ms: Date.now() - startTime,
      body_length: bodyNow.length,
      stable_for_ms: stableFor,
      still_thinking: stillThinking
    });
    
    // Condición de éxito: body creció en algún momento, está estable por >stabilityWindowMs, y no hay indicadores de "pensando"
    if (everGrew && stableFor >= stabilityWindowMs && !stillThinking) {
      const qIdx = bodyNow.lastIndexOf(QUESTION);
      if (qIdx >= 0) {
        answer = bodyNow.substring(qIdx + QUESTION.length).trim();
      } else {
        answer = bodyNow.substring(bodyBefore.length).trim();
      }
      // Limpiar indicadores de UI residuales
      for (const ind of thinkingIndicators) {
        answer = answer.split(ind).join('').trim();
      }
      // Limpiar disclaimers comunes
      answer = answer.replace(/NotebookLM puede ofrecer respuestas inexactas\.?\s*Compru[eé]balas\.?/gi, '').trim();
      answer = answer.replace(/El historial de chat ahora se guarda[^.]*\./gi, '').trim();
      
      if (answer.length > 4000) answer = answer.slice(0, 4000) + '...[truncated]';
      log.push({ step: 'answer_captured', total_wait_ms: Date.now() - startTime, answer_length: answer.length });
      break;
    }
  }
  
  if (!answer) {
    // Captura el body final aunque no haya estabilizado
    const finalBody = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
    const qIdx = finalBody.lastIndexOf(QUESTION);
    if (qIdx >= 0) {
      answer = finalBody.substring(qIdx + QUESTION.length).trim().slice(0, 4000);
    }
    log.push({ step: 'timeout_or_no_stability', total_wait_ms: Date.now() - startTime, final_body_length: finalBody.length, captured_anyway_length: answer.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/notebooklm/n3_answer.txt', answer || '[NO ANSWER CAPTURED]');
  console.log(`N3: typed=${typed} | sent=${sent} | answer_length=${answer.length} | answer_preview="${answer.slice(0, 200)}"`);
}

main().catch(e => { console.error('N3 ERROR:', e.message); process.exit(1); });
