# Pendientes técnicas

Última actualización: 2026-05-01

## Pendiente 1 — L3 LinkedIn clasificación

**Problema:** L3 clasifica perfiles sobre el campo `display` (texto del enlace = nombre de la persona) en vez de sobre el título profesional que vive en el body.
**Síntoma:** 0 TARGETS clasificados aunque hay perfiles válidos.
**Fix:** extraer texto contextual al nombre del perfil del body y clasificar sobre eso.
**Archivo afectado:** `scripts/linkedin/l3_keyword_filter.ts`

## Pendiente 2 — F1 Fiverr CAPTCHA intermitente

**Problema:** Fiverr sirve "It needs a human touch" (PXCR10002539) en la primera petición tras inactividad. F3 pasa minutos después en la misma sesión sin problema.
**Síntoma:** F1 falla, F2 y F4 caen en cadena.
**Fix:** retry con espera + warm-up de sesión, o anti-detección real (Reparación 3 anti-bot).
**Archivos afectados:** `scripts/fiverr/f1_search_gigs.ts`, `src/tools/web_search.ts`

## Pendiente 3 — U1 Upwork Cloudflare Turnstile

**Problema:** mismo patrón que Fiverr. Cloudflare en primera petición. U3 pasa minutos después.
**Fix:** mismo que pendiente 2.

## Pendiente 4 — U5 Upwork falso positivo

**Problema:** detector de bloqueo encuentra "captcha" en body de un job real (freelancer escribió "I have already purchased captchas" en su propuesta).
**Fix:** distinguir captcha en header/title/redirect (real) vs mención en body (legítimo).
**Archivo afectado:** `scripts/upwork/u5_block_detector.ts`

## Pendiente 5 — Y3 YouTube `browser_click` no soporta SVG/aria-label

**Problema:** botón "More actions" en YouTube es SVG con aria-label, sin texto visible.
**Fix:** extender `browser_click` para aceptar selector CSS y aria-label, no solo texto.
**Archivo afectado:** `src/tools/browser_click.ts`

## Pendiente 6 — Y4 YouTube comentarios lazy

**Problema:** YouTube no carga comentarios hasta hacer scroll. Body extraído sin scroll = sin comentarios.
**Fix:** primitiva nueva `browser_scroll` (scroll N veces, espera carga, re-extrae).
**Archivo nuevo:** `src/tools/browser_scroll.ts`

## Pendiente 7 — N1-N4 NotebookLM SPA

**Problema:** NotebookLM es SPA pura. Notebooks no exponen URLs en `<a href>`. Son elementos interactivos JS.
**Fix:** Shinobi necesita primitiva para clickar elementos por posición/aria-label/role y extraer la URL resultante post-navegación.
**Archivos afectados:** `src/tools/browser_click.ts`, `src/tools/web_search.ts`, posibles tools nuevas.

## Pendiente 8 — C2 CoinGecko parsing de tabla

**Problema:** página 2 de ranking carga, regex no parsea filas en rango 101-200 porque CoinGecko usa tabla compleja con rank no en texto plano lineal.
**Fix:** parser específico de tabla CoinGecko, o navegar por buscador (`/search`) en vez de paginación.
**Archivo afectado:** `scripts/coingecko/c2_position_183.ts`

## Pendiente 9 — Eje C nunca arrancado

Cero posts publicados en LinkedIn. Roadmap original Fase 0.5 pedía post por cada prueba superada.

## Patrón unificado de las pendientes

Las 8 pendientes técnicas se agrupan en 3 patrones:
- **Patrón A — anti-bot intermitente:** F1, U1
- **Patrón B — primitivas DOM faltantes:** Y3, Y4, N1-N4, C2 parcial
- **Patrón C — calibración de heurísticas:** L3, U5
