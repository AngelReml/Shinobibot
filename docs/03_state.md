# Estado actual

Última actualización: 2026-05-02

## Funcionando confirmado

- CLI `shinobi` global, modos `/mode local`, `/mode kernel`, `/mode auto`
- Kernel OpenGravity en :9900, dashboard en :18789
- 12 tools registradas en Shinobi (las 9 originales + browser_click extendido + browser_scroll + browser_click_position + web_search_with_warmup)
- Comet con CDP en :9222, sesiones del usuario reusables
- Memoria persistente `memory.json`

## Capa 1 — Calibración de heurísticas (CERRADA)

- L3 LinkedIn clasifica sobre body context, no solo display. 11 perfiles → 5 TARGETS, 6 EXCLUDED, 0 UNKNOWN con keyword "wholesale insurance broker"
- U5 Upwork separa señales CRITICAL (header/redirect/title) de WEAK (body), elimina falsos positivos
- C2 CoinGecko búsqueda por tokens de rank, rank 183 = Theta Network (THETA) $0.1998

## Capa 2 — Primitivas DOM (CERRADA)

Tres tools nuevas o extendidas en src/tools/, validadas con flujos reales en SPAs y vídeo:

- `browser_click` extendido: 3 estrategias en cascada (CSS selector → aria-label → texto)
- `browser_scroll` nueva: scroll N veces con espera y re-extracción
- `browser_click_position` nueva: clic ordinal por selector CSS para SPAs sin URLs únicas

Validación end-to-end:
- N1 NotebookLM: detecta 17 notebooks via tr.mat-mdc-row (selector confirmado por inspección de DOM)
- N2 NotebookLM: clic posicional navega a notebook real, URL contiene /notebook/<id>
- N3 NotebookLM: typed=true, sent=true, captura respuesta del LLM con espera de estabilización (46s, 1276 chars de respuesta coherente)
- N4 NotebookLM: 3 botones de Audio Overview detectados (Copiar/Buen/Mal resumen) + marcadores Studio
- Y3 YouTube: 209 líneas de transcript extraídas (estrategia: expandir descripción primero, no menú "..." del player)
- Y4 YouTube: 13 comment threads estructurados con autor + content (header dice 6432 totales)

Patrón validado: conectar CDP directo, NO re-navegar dentro del flujo, esperar estabilización.

## Capa 3 — Anti-bot (CERRADA PARCIAL)

Tool nueva `web_search_with_warmup` con 3 mecanismos:

- Warm-up: petición sacrificial a /robots.txt antes de la URL real
- Retry con backoff exponencial: detecta señales (CAPTCHA, Cloudflare, "Un momento", PXCRxxxx) y reintenta hasta 3 veces
- Stealth initScript: parchea navigator.webdriver, chrome.runtime, plugins, languages, WebGL vendor/renderer, permissions API

Resultados:
- Fiverr: 0/3 bloqueos. Stealth + warm-up suficiente
- Upwork: 3/3 bloqueos persistentes. Cloudflare Turnstile detecta a nivel TLS/JA3, fuera del alcance de Playwright puro. Documentado como "requiere Camoufox/proxy residencial/solver de Turnstile, fuera de scope actual"

## Roto / no implementado

- Anti-bot Cloudflare Turnstile (Upwork): requiere browser anti-detection (Camoufox) o solver pago (2Captcha/CapSolver). Fuera de scope hoy.
- Pivot automático de estrategia en `mission_runtime.ts` del kernel: LoopDetector existe en Shinobi pero el kernel no lo usa
- Setup de API key configurable por usuario final (hoy hardcodeada en .env). Pendiente para visión cumbre (.exe distribuible).
- Control de aplicaciones nativas Windows: necesario para NotebookLM desktop. Pendiente para visión cumbre.
