# Estado actual

Última actualización: 2026-05-01

## Funcionando confirmado

- CLI `shinobi` global, conexión kernel `/mode kernel` y modo `/mode auto`
- Kernel OpenGravity en :9900, dashboard en :18789
- 9 tools registradas en Shinobi
- `web_search` con extracción real de body, links, interactive elements (post fix de URLs y page.evaluate)
- `browser_click` con búsqueda por texto en pestaña activa CDP
- Loop detection con escalado a humano (test 4/4 PASS)
- Comet with CDP en 9222, sesiones reusables del usuario
- Memoria persistente `memory.json`
- Validación end-to-end en 6 plataformas externas (ver session log de hoy)

## Roto / no implementado

- Tools de interacción DOM más allá de click por texto (selector CSS, aria-label, scroll, type+send a inputs, esperar elemento)
- Anti-detección browser (CAPTCHAs intermitentes en Fiverr/Upwork detienen primera petición)
- Pivot automático de estrategia en `mission_runtime.ts` del kernel (LoopDetector existe en Shinobi pero el kernel no lo usa)
- `StrategyMemoryEngine.findRelevantStrategies` existe pero nadie la llama
- Setup de API key configurable por usuario (hoy hardcodeada en .env)
- Control de aplicaciones nativas de Windows (necesario para NotebookLM desktop)

## Reparaciones pendientes pequeñas

Ver `04_pending.md`.
