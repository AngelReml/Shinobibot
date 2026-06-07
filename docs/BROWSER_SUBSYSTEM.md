# Subsistema de Navegador "Kage" — arquitectura

**Estado:** v1, 2026-06-06.
**Objetivo:** dar a Shinobi automatización de navegador de calidad comparable a
los agentes punteros (Antigravity y similares), pero corrigiendo las decisiones
frágiles de esos diseños.

Este documento parte de una propuesta de referencia (modelo "coordenada-céntrico"
clásico: el agente elige un selector → el runtime calcula el *bounding box* en
píxeles → inyecta `Input.dispatchMouseEvent` en X,Y) y explica **qué mejoramos y
por qué**, antes de detallar la implementación real en `src/browser/`.

---

## 0. El reparto cerebro / ejecutor (igual que la propuesta)

- **El LLM (cerebro):** no abre ventanas ni mueve el ratón. Emite `tool_calls`
  JSON. Punto.
- **El Runtime (ejecutor):** el proceso Shinobi en tu Windows. Recibe los JSON,
  habla con el navegador por **CDP sobre WebSocket** (vía Playwright), ejecuta y
  devuelve resultados.

Hasta aquí coincidimos. Lo que cambia es **qué información viaja entre ambos** y
**cómo se garantiza que una acción realmente ocurrió**.

---

## 1. Las 5 mejoras sobre el modelo de referencia

### Mejora 1 — Observación por *mapa de elementos con ref estable*, no por coordenadas

El modelo de referencia hace que el LLM elija un selector CSS/XPath y luego
clickea en píxeles X,Y. Esto es frágil por tres motivos: (a) los selectores
generados por un LLM fallan en cuanto cambia una clase; (b) las coordenadas se
rompen con scroll, zoom, reflow o resoluciones distintas; (c) el LLM "adivina"
sobre HTML crudo, que es ruidoso y caro en tokens.

**Lo que hacemos:** `browser_observe` inyecta un script que recorre el DOM,
detecta los elementos **interactivos y visibles** (links, botones, inputs,
selects, roles ARIA clicables), les asigna un entero `ref` y los **etiqueta en
el propio DOM** con `data-kage-ref="N"`. Devuelve al LLM un mapa limpio:

```
[1] link "Iniciar sesión"  (a)
[2] input "Correo electrónico"  (email)
[3] input "Contraseña"  (password)  🔒sensitive
[4] button "Entrar"  (submit)
```

El LLM no ve HTML; ve una lista numerada legible. Para actuar, no da un selector:
da un `ref`. `browser_act` resuelve `[data-kage-ref="N"]` a un *element handle*
fresco en el momento de actuar. Refs estables, baratos en tokens, sin adivinar.

### Mejora 2 — Acción anclada con Playwright + reintento por *staleness*, CDP solo de respaldo

El modelo de referencia dispara `Input.dispatchMouseEvent(mousePressed/Released)`
en coordenadas crudas. Nosotros usamos **el `ElementHandle` de Playwright** como
vía principal: `handle.click()` hace *actionability checks* (visible, habilitado,
estable, no tapado) antes de clickear — algo que el dispatch crudo no hace. Si el
elemento se "desprende" entre observar y actuar (SPA que re-renderiza),
re-snapshot automático y un reintento. **El dispatch crudo de CDP por X,Y queda
como fallback** (`action: "click_xy"`) para canvas/WebGL donde no hay DOM.

### Mejora 3 — Verificación post-acción (la capa que el modelo de referencia omite)

El modelo de referencia dispara el evento y *asume* que funcionó. Nosotros
capturamos señales **antes y después** de cada acción y devolvemos un veredicto
`verified`:

- cambio de URL,
- nº de mutaciones del DOM observadas (MutationObserver corto),
- si el elemento objetivo se desprendió (típico de navegación/submit correcto),
- hash de un screenshot reducido (cambió la pantalla / no cambió).

Así el LLM sabe distinguir "clické y no pasó nada" de "clické y avancé", y puede
adaptarse en el mismo turno en vez de seguir a ciegas.

### Mejora 4 — Doble bloqueo de entrada (UI **y** motor), no solo UI

El modelo de referencia bloquea tus clics solo en la capa del panel (porque ves
un vídeo, no la ventana real). Nosotros añadimos un bloqueo **en el motor**:
durante una acción del agente, `Input.setIgnoreInputEvents(true)` hace que el
propio Chromium ignore ratón/teclado físicos, eliminando *race conditions* aunque
estés operando tu Chrome real. Se libera al terminar la acción (con `finally`,
nunca queda colgado).

### Mejora 5 — Consentimiento de navegador propio, *timeout = DENEGAR*

El gate global de aprobaciones del repo está desactivado (FIX-002, todo se
auto-aprueba y el timeout aprueba). Para el navegador eso es peligroso (un submit
con tu sesión logueada puede comprar, publicar, borrar). Añadimos un
consentimiento **independiente y específico** que se dispara solo ante acciones
sensibles: campos de contraseña, submits cross-origin, descargas, y navegación a
hosts no vistos. Reutiliza el canal WS existente (`approval_request` /
`approval_response` + `pendingApprovals`), pero con **política propia: si no
respondes en el plazo, se DENIEGA** (al revés que el gate global). Configurable
con `KAGE_CONSENT=off|sensitive|all` y `KAGE_CONSENT_TIMEOUT_MS`.

---

## 2. Módulos (`src/browser/`)

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Tipos compartidos: `ElementRef`, `Snapshot`, `ActResult`, `VerifySignals`. |
| `session.ts` | Singleton `KageSession`: conecta vía `connectOrLaunchCDP()`, mantiene la `page` activa y su `CDPSession`, lock de entrada, ciclo de vida. |
| `observer.ts` | `snapshot(page)`: inyecta el recorrido del DOM, etiqueta `data-kage-ref`, devuelve mapa de elementos + screenshot opcional. |
| `actor.ts` | `act(session, cmd)`: resuelve ref→handle, ejecuta click/type/select/scroll/navigate/click_xy con lock + reintento por staleness. |
| `verifier.ts` | `captureSignals` antes/después y `verdict()` → `{ verified, why }`. |
| `screencast.ts` | `startScreencast/stop`: `Page.startScreencast` → emite `browser_frame` (JPEG base64, throttled) por un `EventEmitter`. |
| `consent.ts` | `requestBrowserConsent(action)`: clasifica sensibilidad y enruta por el canal de aprobación con política timeout-deny. |

## 3. Tools expuestos al LLM (capa fina sobre `src/browser/`)

- **`browser_observe`** (read-only): devuelve el mapa de elementos de la pestaña
  activa. Es lo primero que el agente llama. Sin efectos secundarios.
- **`browser_act`** (con consentimiento condicional): ejecuta una acción por
  `ref` (o `xy` de respaldo) y devuelve el resultado **con el veredicto de
  verificación**. Tras una acción que cambia la página, re-observa solo si se le
  pide (`reobserve: true`) para ahorrar tokens.
- **`browser_session`**: `open`/`close`/`status`/`screencast on|off`/`navigate`.

## 4. Integración con lo existente (no se reinventa nada)

- Conexión: reutiliza `connectOrLaunchCDP()` de `browser_cdp.ts` (respeta modo
  sandbox/CDP-remoto/local que ya existe).
- Registro: los 3 tools se añaden a `src/tools/index.ts` con `registerTool`.
- Streaming: los frames y eventos viajan por el `broadcastAll` y el WS `/ws` que
  ya usa el WebChat; el panel `public/browser.html` es un consumidor más.
- Consentimiento: reutiliza `pendingApprovals` + `approval_request` del server.
- Auditoría: cada `browser_act` registra `logToolCall` como cualquier tool.
- Prompt: el system prompt ya lista las tools de browser; se actualiza para
  enseñar el flujo observe→act→verify.

## 5. Flujo de una acción (ejemplo: login)

1. Usuario (NL): *"entra en mi cuenta de ejemplo.com"*.
2. LLM → `browser_session {action:"navigate", url:"https://ejemplo.com/login"}`.
3. LLM → `browser_observe` → recibe `[2] input email, [3] input password 🔒, [4] button Entrar`.
4. LLM → `browser_act {ref:2, action:"type", text:"..."}` → `verified:true (dom mutated)`.
5. LLM → `browser_act {ref:3, action:"type", text:"..."}` → **`consent.ts` detecta campo password → modal en tu pantalla** → apruebas → escribe.
6. LLM → `browser_act {ref:4, action:"click", reobserve:true}` → `verified:true (url changed: /dashboard)` + nuevo snapshot.
7. Durante 4–6, `Input.setIgnoreInputEvents(true)` evita que tu ratón interfiera; el panel muestra el screencast en vivo.

## 6. Variables de entorno

| Var | Default | Efecto |
|---|---|---|
| `KAGE_CONSENT` | `sensitive` | `off` nunca pide, `sensitive` solo en acciones de riesgo, `all` en cada `browser_act`. |
| `KAGE_CONSENT_TIMEOUT_MS` | `60000` | Plazo de respuesta; al expirar **se deniega**. |
| `KAGE_SCREENCAST` | `on` | Arranca screencast al abrir sesión. |
| `KAGE_SCREENCAST_QUALITY` | `60` | Calidad JPEG 0–100. |
| `KAGE_SCREENCAST_MAX_FPS` | `4` | Tope de fotogramas/seg enviados al panel. |

---

## 7. Archivos nuevos y validación

**Core** (`src/browser/`): `types.ts`, `session.ts`, `observer.ts`, `actor.ts`,
`verifier.ts`, `screencast.ts`, `consent.ts`.
**Tools** (`src/tools/`): `browser_observe.ts`, `browser_act.ts`,
`browser_session.ts` (registrados en `src/tools/index.ts`).
**UI**: `src/web/public/browser.html` (panel de screencast + modal de consentimiento).
**Skill**: `skills/approved/kage-browser-operator.skill.md`.
**Tocados**: `src/web/server.ts` (asker de consent + broadcast de frames),
`src/constants/prompts.ts` (flujo observe→act→verify), `src/security/approval.ts`
(`browser_observe` read-only).

**Validar en tu máquina** (el sandbox de la sesión no pudo correr tsc por lag de
sincronización del FS):

```
npm run typecheck
npm run dev          # abre WebChat; visita http://localhost:3333/browser.html
```

Prueba funcional sugerida: pídele *"abre example.com y dime qué botones hay"* →
debería hacer `browser_session open` → `browser_observe` y devolverte el mapa de
elementos, con el screencast visible en el panel.
