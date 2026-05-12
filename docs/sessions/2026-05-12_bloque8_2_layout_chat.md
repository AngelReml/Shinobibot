# Bloque 8.2 — Layout triple y chat rediseñado (2026-05-12)

## Qué se entrega

UI completa **rediseñada sin burbujas**, con layout triple (sidebar 260px ·
chat 1fr · panel contextual 320px plegable), sistema de conversaciones
persistido en SQLite, auto-titulación tras el 3er mensaje del usuario y
preservación 100% del protocolo WS heredado.

Sustituye `index.html` del Bloque 1 entero, pero deja intactos:
- el gateway HTTP/Telegram del Bloque 6 (back-compat de `sessionId`)
- todos los eventos WS legacy (`thinking_start`, `thinking`, `tool_call`,
  `final`, `error`, `ask`, `skill_event`, `document_event`)
- el flujo del onboarding del Bloque 7 (gate en `/`)
- el auto-offer del Bloque 5.3

## Archivos nuevos

| Archivo | Propósito |
|---|---|
| `src/web/public/styles/layout.css` | Grid 3-col + responsive. Plega sidebar a 48px strip; panel derecho a 0 colapsado / 320px abierto. |
| `src/web/public/styles/chat.css` | Mensajes sin burbujas. Filete vertical animado (drawDown 300ms) en mensajes del agente. Marca de agua ensō. Cursor parpadeante artesanal. Markdown styling. |
| `src/web/public/js/markdown.js` | Renderer markdown sin dependencias (~140 líneas): code blocks, inline code, bold/italic, headings, listas, enlaces, auto-links. |
| `src/web/public/js/conversations.js` | Sidebar: fetch + render con agrupación temporal **Hoy / Esta semana / Antes** computada en el frontend. CRUD completo. localStorage `shinobi.activeConv`. |
| `src/web/public/js/app.js` | WS handler, composer, sidebar collapse, ask modal, toasts. Sustituye el `<script>` inline que vivía en el HTML del Bloque 1. |
| `test_layout_v2.ts` | E2E hermético 8/8 PASS. |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/web/chat_store.ts` | Nueva tabla `conversations`, columna `conversation_id` en `web_chat_messages` (ADD COLUMN idempotente via try/catch), migration al boot que crea **"Conversación inicial"** absorbiendo cualquier mensaje huérfano. CRUD: `createConversation`, `listConversations`, `getConversation`, `updateTitle`, `deleteConversation`, `ensureConversation`, `bumpLastActive`, `countUserMessages`, `firstUserMessages`, `addInConversation`, `listByConversation`. **Métodos legacy `add(sessionId,...)` y `list(sessionId,...)` preservados** — el gateway del Bloque 6 sigue funcionando sin tocarlo. |
| `src/web/server.ts` | Endpoints REST nuevos: `GET/POST /api/conversations`, `GET /api/conversations/:id/messages`, `PATCH /api/conversations/:id`, `DELETE /api/conversations/:id`. WS `send` acepta `conversationId` (fallback `sessionId` para back-compat). Función `maybeGenerateAutoTitle` que se dispara fire-and-forget tras el 3er mensaje, llama `routedInvokeLLM` para generar un título en español de 3-5 palabras, y emite `conversation_title_updated` a todos los clientes. **Fix crítico**: restaurar `console.*` **antes** del auto-offer hook (si no, sus `console.log` se enviaban como `thinking` events al cliente, generando burbujas pendientes fantasma). |
| `src/web/public/index.html` | Reescrito por completo. Carga `tokens.css` + `base.css` + `layout.css` + `chat.css` + los 3 scripts JS. `<html data-theme="sumi">` por defecto. Estructura: `.dojo` con grid 3-col, `.sidebar` con header/acciones/lista, `.center` con header/chat/input, `.right-panel` placeholder. |

## Decisiones aplicadas (A–F)

- **A. Una sola "Conversación inicial"**: la migración fusiona todos los
  mensajes legacy huérfanos en una única conversación llamada
  "Conversación inicial". Limpio para v1; mezclar es más claro que
  fragmentar artificialmente por `session_id`.
- **B. Contexto compartido v1 (B1)**: la memoria del orchestrator
  (`Memory` + `MemoryStore`) sigue siendo global y compartida entre todas
  las conversaciones del web + CLI + gateway. La separación visual en la
  UI es suficiente para v1. Refactorizar `ContextBuilder` para aislar por
  conversación queda pendiente para un Bloque 9.x.
- **C. Auto-title tras 3 mensajes del usuario**: 1 mensaje suele ser muy
  poco contexto; 3 dan material decente al LLM. Solo dispara si el título
  actual sigue siendo "Conversación nueva" (no autorrenombramos si el
  usuario ya lo personalizó).
- **D. Back-compat `sessionId` confirmado**: el WS `send` acepta
  `conversationId` PRIMERO, y si no llega, usa `sessionId`. El `ChatStore.add`
  legacy mantiene su firma y crea una conversación fantasma si el `sessionId`
  no existe — esto preserva el gateway HTTP/Telegram del Bloque 6 sin
  cambios. El endpoint `GET /api/history?session=X` también está intacto.
- **E. Agrupación Hoy / Esta semana / Antes computada en frontend**:
  `conversations.js::bucketOf(isoDate)` clasifica por la fecha de
  `last_active`. Backend devuelve la lista plana ordenada por
  `last_active DESC`; el frontend agrupa con headers tipográficos
  (Cormorant Garamond uppercase tracking 0.1em).
- **F. Las 4 sorpresas, las cuatro entregadas**:

### F1. Render markdown
`markdown.js` (~140 líneas, cero deps) cubre el subset que el agente emite
con más frecuencia. Estrategia: tokenizar code blocks **primero** con
placeholders para que escape/replace no contaminen su contenido. Soporta:
fences ` ``` `, inline `code`, **bold**, *italic*, `# h1` `## h2` `### h3`,
listas `-` `*` `1.`, `[link](url)` y auto-detección de URLs. El CSS de
`.msg .body pre/code/h1/...` lo viste con `Cormorant Garamond` para
headings y `JetBrains Mono` para código.

### F2. Cursor parpadeante artesanal
En el empty state del chat (frase "El silencio es el principio de la
concentración…"), un `<span class="cursor-blink">` con `width: 2px;
height: 1.1em; background: var(--accent); animation: blink 1.1s steps(2,end)
infinite`. `steps(2, end)` da el corte limpio del cursor de terminal en
lugar de un fade suave — pequeño detalle, gran sensación de oficio.

### F3. Empty state poético en sidebar
Cuando la lista de conversaciones está vacía aparece centrado el haiku
**del usuario** (decidimos usar el suyo, está bien construido):

> *Antes del primer trazo*
> *el pincel sueña con tinta —*
> *todo aún es posible.*

Cormorant Garamond, italic, opacity 0.7, max-width 220px, line-height 1.6.

### F4. Animación del filete del agente (300ms drawDown)
Cada mensaje del agente nuevo dibuja su filete vertical de 2px de arriba
a abajo en 300ms con `cubic-bezier(0.4, 0, 0.2, 1)`:

```css
.msg.agent::before {
  content: '';
  position: absolute;
  left: 0; top: 0;
  width: 2px;
  height: 0;
  background: var(--accent);
  animation: drawDown 300ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes drawDown { from { height: 0 } to { height: 100% } }
```

Para mensajes cargados desde historial (no nuevos), la clase
`.msg.agent.no-anim` salta la animación y deja el filete completo
inmediatamente. Pequeño pero hace que cada respuesta del agente "se trace"
en lugar de aparecer abruptamente.

## Especificación de los endpoints REST

| Verb · Path | Body / Query | Respuesta |
|---|---|---|
| `GET /api/conversations` | — | `{ conversations: Conversation[] }` ordenadas por `last_active DESC` |
| `POST /api/conversations` | `{ title? }` | `{ conversation: Conversation }` (título por defecto `'Conversación nueva'`) |
| `GET /api/conversations/:id/messages` | — | `{ conversationId, messages: Msg[] }` |
| `PATCH /api/conversations/:id` | `{ title }` | `{ ok: true }` o 404 |
| `DELETE /api/conversations/:id` | — | `{ ok: true }` o 404. Cascada: borra los mensajes vinculados |
| `GET /api/history?session=X` *(legacy)* | — | `{ messages: Msg[] }` — preservado para el gateway |

## Protocolo WS extendido

Cliente → Servidor:
```jsonc
// send (nuevo)
{ "type": "send", "text": "…", "conversationId": "conv-abc123", "sessionId": "conv-abc123" }
// El sessionId se envía duplicado por compat — el server prefiere conversationId.

// ask_response (preservado)
{ "type": "ask_response", "text": "…", "requestId": "…" }
```

Servidor → Cliente (nuevo evento):
```jsonc
// Emitido cuando maybeGenerateAutoTitle termina y actualiza el título.
// Broadcast a TODOS los clientes (no solo al que envió).
{ "type": "conversation_title_updated", "conversationId": "conv-abc123", "title": "Análisis de tendencias" }
```

Resto de eventos (`thinking_start`, `thinking`, `tool_call`, `final`,
`error`, `ask`, `skill_event`, `document_event`) sin cambios. El evento
`final` ahora incluye `conversationId` además del payload original.

## Fix crítico — el bug del agente fantasma

Durante la implementación apareció un bug visible solo en el chat. Tras
recibir el `final`, aparecía un segundo mensaje del agente vacío con
estado "pending" perpetuo, conteniendo en su panel de razonamiento líneas
como `[auto-offer] post-task hook fired, content length=29…`.

**Causa**: el monkey-patch de `console.{log,error,warn,info}` se restauraba
en el bloque `finally` — pero el auto-offer hook (Bloque 5.3) llama a
`console.log` ANTES del finally, dentro del scope todavía monkey-patcheado.
Esos logs se enviaban como eventos `thinking` al cliente, que entonces
los procesaba creando un nuevo `pendingAgent` (porque el anterior ya había
sido finalizado y `pendingAgent` era `null`).

**Fix**: restaurar `console.*` inmediatamente después de `ws.send('final')`
y antes del auto-offer hook + auto-title async. El `finally` mantiene la
restauración como idempotent fallback.

Esto también blinda el flujo contra cualquier hook futuro que decida
loggear post-final.

## Tests E2E — 8/8 PASS

```
✓ A. Migration legacy → "Conversación inicial" idempotente   convs=1, orphans=0, linked=3, idempotent=true
✓ B. REST conversations CRUD                                  start=0, afterCreate=1, patch=true, msgs=0, del=true
✓ C. Layout 3-col + tema sumi                                 sidebar=260, center=1020, theme=sumi
✓ D. Sidebar collapse/expand                                  collapsed=48, expanded=260
✓ E. Mensaje sin burbujas + filete agente accent              userBg/agentBg transparent, ::before=rgb(200,65,52) sumi-accent
✓ F. Watermark fade con contenido                             opacity=0.022 (≤ 0.03)
✓ G. Theme change recolorea filete agente                     aurora ::before=rgb(110,231,183) menta
✓ H. Auto-title tras 3 mensajes                               finalTitle="Título Generado Auto", header=match, titleCalls=1
```

**Truco clave**: pre-poblar `config.json` en el sandbox `APPDATA` antes de
arrancar el server, si no el gate del onboarding del Bloque 7 sirve
`onboarding.html` en `/` y el test nunca carga el `index.html` real.

Regresiones — todas PASS:
- `test_design_system` 7/7
- `test_gateway` 6/6
- `test_onboarding` 8/8
- `test_auto_offer` PASS

## Deuda documentada para Bloque 8.3+

- **Contexto compartido entre conversaciones (B1)**: la memoria del
  orchestrator sigue siendo global. Una pregunta hecha en la conv A
  puede ser respondida usando contexto de la conv B porque `Memory` no
  separa por `conversationId`. Refactor del `ContextBuilder` queda
  pendiente.
- **Búsqueda solo en títulos**: el `#search-input` filtra por título
  con `toLowerCase().includes()`. No busca dentro del contenido de los
  mensajes. Para v2 conviene un endpoint `/api/search?q=...` que use
  FTS5 de SQLite.
- **Panel contextual placeholder**: el `.right-panel` muestra "Próximamente
  · Bloque 8.3" — vivirán ahí memorias activas, herramientas en uso,
  fragmentos relevantes.
- **Auto-title vuelve a generar si falla la primera vez**: ahora el trigger
  es `count === 3`. Si falla la llamada al LLM (e.g. el provider devuelve
  string vacío tras sanear), la conv se queda como "Conversación nueva"
  para siempre porque count > 3 en mensajes posteriores. Se puede mitigar
  con `count === 3 || (count > 3 && title === 'Conversación nueva' && count <= 6)`.
