# Audit — ¿Puede Shinobi pedir tareas a ChatGPT desde Comet con sesión abierta?

Fecha: 2026-05-04
Status: **POSIBLE pero frágil**. Falta una pieza concreta para hacerlo robusto.

## Contexto

El roadmap mencionaba "Shinobi navega ChatGPT desde Comet con sesión abierta para pedir tareas de benchmark" como vía alternativa al `/v1/benchmark/auto-gen` que llama OpenRouter directo. Esta auditoría revisa si HOY el código existente lo permite, paso a paso. **No se construye nada.**

## Pipeline requerido

| Paso | Necesidad |
|---|---|
| 1. Tener Comet abierto con sesión Google/ChatGPT logueada | usuario ya lo hace |
| 2. Conectarse a Comet desde Shinobi vía CDP | ✅ |
| 3. Navegar a `chat.openai.com` | ✅ |
| 4. Esperar a que cargue la pestaña con la sesión activa | ✅ |
| 5. Localizar el textarea del prompt | ✅ parcial |
| 6. **Escribir un prompt en el textarea** | ❌ **falta** |
| 7. Pulsar "Enviar" | ✅ con caveat |
| 8. Esperar a que termine la respuesta streamed | ⚠ sin tool dedicada |
| 9. Capturar la respuesta como texto | ✅ |
| 10. Parsear la respuesta a JSON | ✅ |

## Inventario de tools relevantes (read-only)

| Tool | Capacidad | Útil para paso |
|---|---|---|
| `web_search` (`src/tools/web_search.ts`) | `chromium.connectOverCDP('http://localhost:9222')` + navigate + extract body text | 2, 3, 4, 9 |
| `web_search_with_warmup` | igual + anti-bot stealth + retry | 2, 3, 4, 9 (sites con bot-detection) |
| `browser_click` | click por texto / CSS / aria sobre la pestaña activa CDP | 5, 7 |
| `browser_click_position` | click N-ésimo de un selector (SPAs) | 5, 7 |
| `browser_scroll` | scroll para lazy-load + re-extract | (no aplica directo) |
| `screen_act` con `action='type'` | **typear globalmente** en la app con foco — NO específico al browser | 6 (workaround) |

## Pasos detallados — qué funciona, qué no

### Paso 1-2: conexión CDP a Comet
**OK.** `chromium.connectOverCDP('http://localhost:9222')` ya está probado en producción (validación CoinGecko 16s, NotebookLM 4 pruebas — verde en criba).

### Paso 3: navegar a chat.openai.com
**OK.** `web_search` con `query: "https://chat.openai.com/"`. La pestaña reusa el contexto si una ya está en ese origen, si no abre nueva.

### Paso 4: esperar pestaña cargada con sesión
**OK con caveat.** El CDP se engancha al perfil de Comet, donde el usuario ya está logueado. El `await page.goto(..., { waitUntil: 'domcontentloaded', timeout: 30000 })` + `waitForTimeout(3000)` es suficiente para que React monte. Si ChatGPT muestra captcha o "verifying you are human", `web_search_with_warmup` con stealth aplica.

### Paso 5: localizar el textarea
**OK con caveat.** ChatGPT usa `<textarea data-id="root">` o un `[contenteditable=true]` con `[id^="prompt-textarea"]`. `browser_click` con CSS selector `textarea` o `[contenteditable]` puede focalizarlo.

### Paso 6: escribir el prompt — **FALTA TOOL DEDICADA**

**Diagnóstico**: NO existe `browser_type`, `browser_fill`, `browser_sendkeys`, ni `page.type`/`page.fill` expuesto como tool. Inventario completo de tools en `src/tools/`:

```
browser_click            click element
browser_click_position   click Nth element
browser_scroll           scroll
web_search               navigate + extract
web_search_with_warmup   navigate + stealth
screen_act               global mouse/keyboard (nut-js)
screen_observe           screenshot + vision LLM
```

**Workarounds posibles HOY (frágiles):**

- **A — `screen_act type`**: tras `browser_click` para enfocar el textarea, llamar `screen_act { action: 'type', text: '<prompt>' }` que envía keystrokes globales vía nut-js. Funciona si la ventana de Comet está al frente. Falla si:
  - El usuario tiene otra ventana arriba al momento del type → keys van a otra app.
  - El IME del sistema reescribe caracteres (acentos, ñ).
  - La latencia entre click→focus y type es muy corta y el textarea no captura el primer carácter.
  - ChatGPT tiene un editor virtual (contenteditable) que no procesa keystrokes globales bien.

- **B — Inyectar JS via Playwright** desde un nuevo tool: `await page.locator('textarea').fill('<prompt>')` o `await page.evaluate(() => { document.querySelector('textarea').value = '<prompt>' })`. Esto NO está expuesto como tool hoy. Sería trivial añadirlo (≈30 líneas en un nuevo archivo `browser_type.ts` siguiendo el patrón de `browser_click.ts`).

- **C — pyautogui / RPA externa**: no existe en el repo.

### Paso 7: pulsar "Enviar"
**OK con caveat.** `browser_click` con `aria_label: "Send message"` o el botón con SVG. Fragil porque ChatGPT cambia el DOM con frecuencia. Plan B: `screen_act { action: 'press_key', keys: ['Return'] }` tras typear (Enter envía en ChatGPT por defecto).

### Paso 8: esperar respuesta streamed
**No hay tool dedicada.** Patrones posibles:
- Polling: `web_search` (re-extract) cada 2-3s hasta que el último mensaje deje de cambiar (idea: hash el último bloque y comparar consecutivos).
- Esperar a que aparezca el botón "Stop generating" → desaparezca.

Estos requieren código nuevo. No imposible, pero ningún tool actual lo modela.

### Paso 9: capturar respuesta
**OK.** `web_search` retorna `body.innerText` truncado a 12000 chars. Suficiente para una respuesta de bench-gen (15 tareas en JSON ≈ 6-8K chars).

### Paso 10: parsear a JSON
**OK.** Trivial, ya hay extractores JSON en `auto_gen/generator.ts:safeJsonExtract`.

## Pieza concreta que falta

Una tool `browser_type` (sólo Playwright, sin nut-js):

```ts
// pseudocódigo del tool faltante (NO se construye en este audit)
{
  name: 'browser_type',
  description: 'Type text into the focused or located input on port 9222 CDP browser.',
  parameters: {
    selector: { type: 'string', description: 'CSS selector for the input/textarea/contenteditable.' },
    text: { type: 'string' },
    clear_first: { type: 'boolean', default: true },
    submit: { type: 'boolean', default: false, description: 'Press Enter after typing.' },
  },
  async execute({ selector, text, clear_first, submit }) {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const page = browser.contexts()[0].pages()[0];
    const loc = page.locator(selector).first();
    if (clear_first) await loc.fill('');
    await loc.fill(text);  // robusto: sets value + dispatches input/change events
    if (submit) await loc.press('Enter');
    return { success: true, output: 'typed' };
  }
}
```

Con esto, los pasos 6 y 7 quedan robustos.

## Bonus: paso 8 robust

Una tool `browser_wait_for_stable` que devuelve cuando el `body.innerText` no cambia en X iteraciones consecutivas, indicando que el streaming terminó:

```ts
// pseudocódigo
async execute({ stable_iters = 3, poll_ms = 1500, timeout_ms = 60000 }) {
  let prev = ''; let stable = 0; const t0 = Date.now();
  while (Date.now() - t0 < timeout_ms) {
    const txt = await page.innerText('body');
    if (txt === prev) stable++; else { stable = 0; prev = txt; }
    if (stable >= stable_iters) return { success: true, output: txt };
    await page.waitForTimeout(poll_ms);
  }
  return { success: false, error: 'timeout waiting for stable' };
}
```

## Veredicto

| Pregunta original | Respuesta |
|---|---|
| ¿Puede Shinobi HOY pedir tareas a ChatGPT desde Comet? | **Posible pero frágil**. Funciona si: (a) el usuario tiene Comet al frente, (b) el textarea acepta keystrokes globales, (c) ChatGPT no cambió el DOM esa semana. |
| ¿Sin construir nada, podríamos correr un E2E? | **Técnicamente sí** con `screen_act type`. Realísticamente fallaría 1 de cada 3 intentos por focus/timing. **No recomendable como pipeline de producción.** |
| ¿Qué pieza concreta falta para que sea robusto? | **`browser_type`** — un único tool nuevo de ~30 líneas con Playwright `locator.fill`. Y un `browser_wait_for_stable` opcional para el streaming. |
| ¿Vale la pena vs `/v1/benchmark/auto-gen` directo? | El path Comet+ChatGPT tiene ventajas únicas: (1) **plan ChatGPT Plus** sin pagar OpenRouter API por token, (2) usa la sesión del usuario (relación humano-modelo), (3) puede aprovechar Custom GPTs y Memory que no están en API. Costo: latencia 5-10x mayor + DOM brittleness. |

## Recomendación (no construyo nada)

Antes de ejecutar la vía Comet+ChatGPT como pipeline real:
1. Construir `browser_type` (1 archivo, 30 líneas, patrón calcado de `browser_click.ts`).
2. Construir `browser_wait_for_stable` (otra tool similar).
3. Hacer un test E2E de "abrir ChatGPT, mandar un prompt simple, recibir respuesta" en `src/tools/__tests__/`.
4. SÓLO entonces enchufar al `auto_bench` como `provider` alternativo.

**Tiempo estimado de implementación**: 2-3h código + 30 min test. Coste $0 (no LLM).

Esta lista queda como TODO si el usuario decide priorizarlo. **No actúo sin tu OK explícito.**
