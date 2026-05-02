import { writeFileSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';

mkdirSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini', { recursive: true });

const GEMINI_URL = 'https://gemini.google.com/app';
const PROMPT = 'hola';

async function main() {
  const log: any[] = [];
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('NO BROWSER CONTEXT');
    process.exit(1);
  }
  
  // PASO A — Abrir pestaña nueva
  const page = await ctx.newPage();
  log.push({ step: 'new_page_opened', success: true });
  
  // PASO B — Navegar a Gemini
  await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);  // dar tiempo a que cargue la SPA
  
  const initialState = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    body_chars: ((document.body as any).innerText || '').length
  }));
  log.push({ step: 'navigate_to_gemini', ...initialState });
  
  // Verificar que estamos logueados (no en pantalla de login)
  if (initialState.url.includes('accounts.google.com') || initialState.url.includes('signin')) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_log.json', JSON.stringify(log, null, 2));
    console.error('GEMINI: redirigido a login. La sesión de Google no está activa en Comet.');
    process.exit(1);
  }
  
  // PASO C — Inventario de inputs candidatos
  const inputInventory = await page.evaluate(() => {
    const candidates: any[] = [];
    const selectors = [
      'rich-textarea[role="textbox"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="ask" i]',
      'textarea[aria-label*="pregunt" i]',
      'textarea',
      '[role="textbox"]'
    ];
    
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length === 0) continue;
      const items = [];
      for (let i = 0; i < els.length && i < 3; i++) {
        const el = els[i] as HTMLElement;
        items.push({
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          role: el.getAttribute('role') || '',
          visible: el.offsetWidth > 0 && el.offsetHeight > 0
        });
      }
      candidates.push({ selector: sel, count: els.length, samples: items });
    }
    return candidates;
  });
  log.push({ step: 'input_inventory', candidates: inputInventory });
  
  // PASO D — Elegir primer selector con elemento visible y escribir
  let chosenSelector = '';
  for (const cand of inputInventory) {
    const visibleSample = cand.samples.find((s: any) => s.visible);
    if (visibleSample) {
      chosenSelector = cand.selector;
      break;
    }
  }
  
  if (!chosenSelector) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_log.json', JSON.stringify(log, null, 2));
    console.error('GEMINI: no se encontró input visible');
    process.exit(1);
  }
  log.push({ step: 'selector_chosen', selector: chosenSelector });
  
  let typed = false;
  try {
    const locator = page.locator(chosenSelector).filter({ visible: true }).first();
    await locator.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    
    // Para contenteditable, fill no siempre funciona — usar type/keyboard
    const tag = (chosenSelector.toLowerCase().includes('contenteditable') || chosenSelector.toLowerCase().includes('rich-textarea') || chosenSelector.toLowerCase().includes('role="textbox"')) ? 'contenteditable' : 'textarea';
    
    if (tag === 'textarea') {
      await locator.fill(PROMPT, { timeout: 5000 });
    } else {
      // contenteditable: keyboard.type es más fiable
      await page.keyboard.type(PROMPT, { delay: 50 });
    }
    typed = true;
    log.push({ step: 'type_prompt', success: true, method: tag, prompt: PROMPT });
  } catch (e: any) {
    log.push({ step: 'type_prompt', success: false, error: e.message });
  }
  
  if (!typed) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_log.json', JSON.stringify(log, null, 2));
    console.error('GEMINI: no se pudo escribir el prompt');
    process.exit(1);
  }
  
  await page.waitForTimeout(800);
  
  // Capturar body antes de enviar
  const bodyBefore = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
  log.push({ step: 'body_before_send', length: bodyBefore.length });
  
  // PASO E — Enviar con Enter
  let sent = false;
  try {
    await page.keyboard.press('Enter');
    sent = true;
    log.push({ step: 'send_enter', success: true });
  } catch (e: any) {
    log.push({ step: 'send_enter', success: false, error: e.message });
  }
  
  if (!sent) {
    writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_log.json', JSON.stringify(log, null, 2));
    process.exit(1);
  }
  
  // PASO F — Esperar respuesta. Estrategia: estabilización del body durante 5s sin indicadores de "pensando"
  const thinkingIndicators = ['Pensando', 'Thinking', 'Generando', 'Generating'];
  const startWait = Date.now();
  const maxWaitMs = 60000;
  const stabilityWindowMs = 5000;
  const pollMs = 2000;
  
  let lastBodyLength = bodyBefore.length;
  let lastChangeTime = Date.now();
  let everGrew = false;
  let answer = '';
  
  while (Date.now() - startWait < maxWaitMs) {
    await page.waitForTimeout(pollMs);
    const bodyNow = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
    
    if (bodyNow.length !== lastBodyLength) {
      lastBodyLength = bodyNow.length;
      lastChangeTime = Date.now();
      if (bodyNow.length > bodyBefore.length + 30) everGrew = true;
    }
    
    const stableFor = Date.now() - lastChangeTime;
    const stillThinking = thinkingIndicators.some(ind => bodyNow.includes(ind));
    
    log.push({
      step: 'poll',
      elapsed_ms: Date.now() - startWait,
      body_length: bodyNow.length,
      stable_for_ms: stableFor,
      still_thinking: stillThinking
    });
    
    if (everGrew && stableFor >= stabilityWindowMs && !stillThinking) {
      // Capturar respuesta: lo nuevo después de la última aparición de "hola"
      const lastHolaIdx = bodyNow.toLowerCase().lastIndexOf(PROMPT.toLowerCase());
      if (lastHolaIdx >= 0) {
        answer = bodyNow.substring(lastHolaIdx + PROMPT.length).trim();
      } else {
        answer = bodyNow.substring(bodyBefore.length).trim();
      }
      
      // Limpiar UI residual de Gemini
      const uiNoise = [
        /Gemini puede mostrar informaci[oó]n imprecisa.*/gi,
        /Gemini may display inaccurate.*/gi,
        /Verifica las respuestas importantes/gi,
        /Tus chats[^.]*\./gi,
        /Compartir/g,
        /Enviar comentarios/g
      ];
      for (const re of uiNoise) {
        answer = answer.replace(re, '').trim();
      }
      
      if (answer.length > 4000) answer = answer.slice(0, 4000) + '...[truncated]';
      log.push({ step: 'answer_captured', total_wait_ms: Date.now() - startWait, answer_length: answer.length });
      break;
    }
  }
  
  if (!answer) {
    const finalBody = await page.evaluate(() => ((document.body as any).innerText || '').replace(/\s+/g, ' ').trim());
    answer = finalBody.substring(bodyBefore.length).slice(0, 4000);
    log.push({ step: 'timeout_partial_capture', answer_length: answer.length });
  }
  
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_log.json', JSON.stringify(log, null, 2));
  writeFileSync('C:/Users/angel/Desktop/shinobibot/artifacts/gemini/hola_answer.txt', answer || '[NO ANSWER]');
  
  console.log(`GEMINI: typed=${typed} | sent=${sent} | answer_chars=${answer.length}`);
  console.log(`---ANSWER START---`);
  console.log(answer);
  console.log(`---ANSWER END---`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
