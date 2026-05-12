# Bloque 8.3 — Antesala mínima + chat Stitch (2026-05-12)

## Qué se entrega

Reemplazo completo de la UI del Bloque 8.2 con:

1. **Antesala mínima**: pantalla negra fullscreen, `shinobi-mark.png` centrado
   a 320px de ancho recoloreado en blanco. Fade in 1.2s · hold 1.5s ·
   fade out 0.8s. Después el chat emerge con fade in 0.6s. **Sin SVG
   complejo, sin sonido, sin jardín** — solo el logo, el negro, y el
   silencio.

2. **Chat interior**: rediseñado siguiendo `shinobi_active_conversation_hiru`
   de Stitch — sidebar 280px con logo PNG real, max-width 800px, paletas
   Hiru/Yoru reemplazando las 4 anteriores, toggle ☀/☾, modo concentración
   Ctrl+.

3. **Cursor-pincel como easter egg**: el rastro de tinta canvas + cursor
   SVG (originalmente diseñado para la antesala compleja) **se preserva
   migrado al input del chat** — aparece solo cuando el composer está
   vacío y el ratón pasa por encima del `.input-shell`. Trazo en color
   `var(--accent)`, decay 2s.

El backend (WebSocket, REST, orchestrator) no se toca. Los IDs de DOM
que `app.js`/`conversations.js`/`markdown.js` consumen se preservan.

## Archivos nuevos

| Archivo | Propósito |
|---|---|
| `src/web/public/styles/antesala.css` | Pantalla negra fullscreen, `@keyframes antesala-mark-cycle` (fade in / hold / fade out en 3.5s), botón skip, estilos del cursor-pincel + canvas overlay. |
| `src/web/public/js/antesala.js` | Timing: `setTimeout(3500ms)` dispara dissolve + chat fade-in. Skip por click/Enter/Espacio/Escape. `sessionStorage.shinobiEntered` salta la secuencia en visitas posteriores. |
| `test_bloque8_3.ts` | E2E 4/4 PASS. |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/web/public/index.html` | Antesala simplificada: `<div id="antesala">` + `<img id="antesala-mark">` + botón skip. Brush cursor (SVG) y canvas overlay viven a nivel raíz para sobreponerse sobre el input. Chat-app oculto inicialmente (opacity 0, pointer-events none). Tailwind CDN con config mapeado a `var(--bg)` etc. Botón theme-toggle sol/luna. |
| `src/web/public/styles/tokens.css` | Borradas las 4 paletas del 8.1. Añadidas `hiru` (#fff8f6 papel) y `yoru` (#1a1612 tierra quemada). Mismos nombres de variables (`--bg`, `--accent`, `--accent-soft`, `--enso-invert`) — el resto de la app no se entera del cambio. |
| `src/web/public/js/theme.js` | `VALID=['hiru','yoru']`, `DEFAULT='hiru'`, nuevo `toggle()`. Migration suave: legacy sumi/kintsugi/aurora→yoru, bushido→hiru. |
| `src/web/public/styles/layout.css` | `--sidebar-w` 260→280px, `--center-max-w` 800px. Modo concentración `[data-focus="on"]`. Estilos del logo PNG (`.brand-shinobi-img` con filter brightness/invert). Reglas del theme-toggle sol/luna. |
| `src/web/public/js/app.js` | Handler theme-toggle (`ShinobiTheme.toggle()`). Atajo Ctrl/Cmd+. para modo concentración. **`setupBrushEasterEgg()`**: mousemove → si está sobre `.input-shell` y composer vacío → muestra brush cursor + push punto al trail; canvas dibuja en `var(--accent)` con decay lineal a 2s. |
| `src/web/public/styles/antesala.css` | Reglas del brush cursor + canvas, `.input-shell.brush-active { cursor: none }`. |
| `src/web/public/theme-preview.html` | Sólo botones hiru/yoru. |
| `test_layout_v2.ts` | sessionStorage bypass + temas renombrados. |
| `test_design_system.ts` | **Eliminado** (las 4 paletas que testeaba ya no existen). |

## Decisiones del usuario aplicadas

- **A — Tailwind via CDN se queda (i)**: `tailwind.config` mapea colores
  a `var(--bg)`, `var(--accent)`, etc. Cambiar `data-theme` recolora
  todas las utility classes sin recompilar.

- **B — Reemplazo limpio 4→2 (i)**: solo hiru y yoru. Migration suave en
  theme.js evita que un usuario con localStorage legacy quede varado.

- **Pivote sobre la antesala (post-implementación)**: tras una primera
  versión con jardín SVG complejo + audio + komorebi + bambú + uguisu,
  el usuario pidió descartar todo y hacer una antesala mínima de logo
  blanco sobre negro. **El cursor-pincel sobrevivió como easter egg**
  migrado al input del chat — aparece cuando el composer está vacío y
  el ratón roza la `.input-shell`.

## Antesala — secuencia exacta

```
t=0      antesala visible, mark opacity 0
t=0→1.2s mark fade in
t=1.2→2.7s mark hold opacity 1
t=2.7→3.5s mark fade out
t=3.5s   antesala.classList.add('dissolving') → opacity 1→0 en 0.6s
         chat-app.opacity = 1 + pointer-events: auto
t=4.1s   antesala.classList.add('hidden')
         sessionStorage.setItem('shinobiEntered', 'true')
```

Skip por click, Enter, Space o Escape → cubre la fase con `dissolving` +
revela chat en ~350ms.

## Easter egg del cursor-pincel

- **Activación**: mousemove → `over = isOver(ev.clientX, ev.clientY)` con
  `getBoundingClientRect()` del `.input-shell` && `composer.value.trim().length === 0`.
- **Visual**: SVG flotante de 18×18px (pincel vertical con bola) que
  sigue al ratón. Hereda `currentColor: var(--accent)` — vermellón en
  ambas paletas.
- **Trail canvas**: position fixed sobre toda la pantalla, pointer-events
  none. Cada frame: borrar, redibujar todos los segmentos consecutivos
  del array con `lineWidth = 2.5 * alpha + 0.6` y `strokeStyle` en RGBA
  derivado del `--accent` con alpha decay lineal en 2000ms.
- **Cursor nativo**: oculto via `.input-shell.brush-active { cursor: none }`
  solo cuando el easter egg está activo.

## Tests E2E — 4/4 PASS

```
✓ A. Antesala carga fresh (negro + mark)      bg=rgb(0,0,0), mark src=/assets/shinobi-mark.png, theme=hiru
✓ B. shinobiEntered=true salta antesala       antesalaHidden=true, chatVisible=true
✓ C. WS conecta + send → final                agentMsg="Eco: hola desde test"
✓ D. Toggle hiru→yoru cambia bg               #fff8f6 → #1a1612
```

Regresiones:
- `test_layout_v2` 8/8 PASS
- `test_onboarding` 8/8 PASS
- `test_gateway` 6/6 PASS

## Deuda

- **theme-preview.html** simplificado a 2 paletas. Si en el futuro se
  quieren más, hay que añadirlas en tokens.css + theme.js.
- **Audio API**: el módulo `antesala_audio.js` fue eliminado.
- **Garden assets**: el código del jardín complejo (komorebi, uguisu,
  shishi-odoshi, bamboo) no se preserva en el repo. Si el usuario quiere
  volver a esa estética habría que recuperarla del commit anterior
  (`a524d38` no la tenía aún; la primera versión del 8.3 sí).
