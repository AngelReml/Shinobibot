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

## D-009 (2026-05-02) — Patrón para flujos multi-paso en SPAs: CDP directo, NO re-navegar

Detectado al fallar N2 NotebookLM la primera vez: el script clickaba con `browser_click_position` y luego volvía a invocar `web_search` con la URL del notebook, lo que disparaba navegación nueva y cancelaba la SPA route. Solución: tras un click, NO re-invocar web_search; conectar directo por `chromium.connectOverCDP` y leer el estado actual de la pestaña.

Esto se generaliza a cualquier flujo multi-paso con primitivas: tras click/scroll/type, la lectura del estado se hace inline contra la pestaña activa, no recreando la navegación.

## D-010 (2026-05-02) — Inspección DOM antes de elegir selector

N1 NotebookLM eligió primero `button[aria-label*="proyecto" i]` que matcheaba "Menú de acciones del proyecto" (botón `more_vert` de cada notebook), no el contenedor del notebook. La heurística "selector con aria-label informativo" da falsos positivos.

Solución implementada: script `scripts/notebooklm/inspect_card_structure.ts` que sube por el árbol de ancestros del primer botón detectado y reporta tag/role/clases. Para NotebookLM la inspección reveló que cada notebook es un `<tr class="mat-mdc-row">` y el `more_vert` está en una columna `actions-column` dentro de la fila. Esto permitió definir prioridad 0 para `tr.mat-mdc-row` antes de los selectores genéricos.

Patrón para próximas SPAs: cuando un script no navegue tras click, ejecutar inspección de ancestros antes de seguir adivinando selectores.

## D-011 (2026-05-02) — YouTube cambió la UI: transcript fuera del menú "..." del player

Y3 falló múltiples veces porque buscaba "Mostrar transcripción" en el menú "Más acciones" del player. La UI actual de YouTube ha movido la opción al panel de descripción expandido (`#description-inner`). Solución implementada: el script ahora expande la descripción primero, luego busca el botón en ese panel. 209 líneas extraídas en validación.

## D-012 (2026-05-02) — Heurística de espera para LLMs vía web

N3 capturó "Pensando..." en vez de la respuesta real del modelo de NotebookLM porque la espera basada en "el body creció" cortaba en la fase de loading. Solución implementada: esperar a que el body se ESTABILICE durante 6 segundos consecutivos sin indicadores de "Pensando..."/"Thinking..."/"Processing material...". Limpiar disclaimers comunes ("respuestas inexactas", "historial de chat se guarda") del resultado.

Validación: 46s de espera real, 1276 chars de respuesta coherente sobre Derek Thompson y la "agenda de la abundancia".

Este patrón sirve para cualquier interacción con LLM via UI web (ChatGPT, Claude.ai, Gemini, Perplexity).

## D-013 (2026-05-02) — Anti-bot: warmup + stealth basta para PerimeterX, no para Cloudflare Turnstile

Fiverr (PerimeterX) cae con warmup a robots.txt + stealth initScript (navigator.webdriver, chrome.runtime, plugins, WebGL spoofing). Upwork (Cloudflare Turnstile) NO cae con la misma estrategia. Cloudflare detecta a nivel TLS/JA3 fingerprint, fuera del alcance de Playwright puro.

Decisión: aceptar el límite. Para romper Cloudflare se necesita Camoufox / patchright / solver pago / proxy residencial. Fuera de scope mientras el Eje A (broker E&S USA) no requiera portales con Turnstile.

## D-014 (2026-05-02) — Capas en lugar de fixes simultáneos

Decidido al pedir "una sola pasada que arregle todo": cuando hay 8 pendientes técnicas en 3 patrones distintos, atacarlas en una pasada inflada confunde el reporte. Mejor: tres capas (C calibración → B primitivas → A anti-bot), cerrar cada una con su validación, después siguiente.

Funcionó: cerramos las 3 capas en una sesión sin perder trazabilidad.
