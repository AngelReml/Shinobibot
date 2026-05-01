# Decisiones arquitectónicas

## D-001 (2026-04-30) — Vertical comercial: insurance brokers E&S USA

Decidido por Iván tras análisis de mercado en chat previo. Razón: necesidad de un solo lenguaje comercial, una sola demo grabable, un solo perfil de cliente para los primeros 3 meses. Evitar la dispersión de los 6 meses anteriores.

Compromiso: arquitectura agnóstica por dentro (un orquestador y adaptadores de portal por carrier), comercialización 100% específica para este nicho. Mañana podemos clonar a immigration o mortgage cambiando solo adaptadores y prompts.

## D-002 (2026-04-30) — Tres ejes paralelos desde Fase 0

Eje A producto + Eje B capacidad + Eje C visibilidad. Lógica: si el mercado no compra, Shinobi no muere; pivota a herramienta personal/cofounder. Cada avance se aprovecha dos veces (producto + visibilidad).

## D-003 (2026-04-30) — Shinobi sigue separado de OpenGravity

Considerada y descartada la fusión en repo único. Razón: shinobibot solo se comunica con OpenGravity por HTTP en :9900. No hay imports de código entre repos. La fusión añadía riesgo (workspaces npm, paths, dependencias divergentes) sin beneficio claro. Mantener dos repos. Un launcher unificado los arranca juntos.

## D-004 (2026-05-01) — `web_search` extrae todo, no solo title

Reparación quirúrgica en 3 fases:
- Fix URL stripping (regex extraía solo dominio, perdía path)
- Extracción real (body text + links + interactive elements)
- Fix bug `__name is not defined` en page.evaluate (esbuild transpila helpers ES6+ que no existen en browser context)

## D-005 (2026-05-01) — `browser_click` como primera tool DOM interactiva

Tool nueva. Click por texto visible o aria-label en pestaña CDP activa. Tres estrategias en cascada (text, getByRole button, getByRole link). Devuelve estado completo post-click. Es la primera primitiva real de "Shinobi sustituto de teclado y ratón".

## D-006 (2026-05-01) — Modo Camaleón actual no sirve para anti-bot browser

`src/utils/undercover.ts` es solo texto de filtro para commits en repos públicos. No tiene nada que ver con anti-detección de Playwright. La capa real anti-detección está pendiente.

## D-007 (2026-05-01) — Sistema de docs persistente

Iván solicita explícitamente. Razón: no quiere repetir contexto al empezar cada chat con cualquier IA. Decidido formato A+C: dentro del repo + categorías + sessions cronológicas.

## D-008 (2026-05-01) — NotebookLM versión web vs app desktop

Bloque 5 ejecutado contra versión web (lo que tools actuales soportan). App desktop nativa requiere otra capa entera (control de UI nativa Windows) que no existe hoy. Queda parqueada para "Visión cumbre" post-Bloque 6.
