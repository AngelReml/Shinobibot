# PLAN_UX_NO_TECNICO.md — romper la barrera del usuario no técnico

> **Estado:** propuesta (nada ejecutado). **Fecha:** 2026-06-12.
> **Método:** cada afirmación de este plan está verificada contra el código real
> (fichero:línea). Regla del repo respetada: ninguna afirmación sin dato medido.
> Al ejecutarse cada bloque, su decisión va a DECISIONES.md.

---

## 0. La tesis

Shinobi ya tiene más UX construida de la que se ve a primera vista: onboarding de
provider, búsqueda global (Ctrl+K), renombrar/borrar/exportar misiones, paleta de
comandos "/", panel Rastro, candado de aprobaciones, .exe con installer que abre el
navegador solo. **El problema no es falta de features: es que tres puntos críticos
fallan o son invisibles justo donde el usuario no técnico los necesita.**

La barrera del no técnico no es localhost. Es: (1) no puede orientarse (títulos
rotos), (2) no puede corregirse (mensajes intocables), (3) no sabe qué puede pedir
(capacidades opacas). Los tres tienen arreglo sin tocar arquitectura.

---

## 1. Diagnóstico — fricciones con causa raíz en el código

| # | Fricción para el no técnico | Causa raíz verificada |
|---|---|---|
| F1 | **Todas las conversaciones se llaman "Conversación nueva"** | `src/web/server.ts:106` — el auto-título solo dispara si `count !== 3 return`: **exactamente** en el 3er mensaje del usuario, una sola vez. Conversaciones de 1-2 mensajes (la mayoría) jamás se titulan. Si el LLM falla en el msg 3 (`server.ts:118-121`), no hay reintento ni fallback: queda sin título para siempre. Las migradas ("Conversación inicial", `chat_store.ts:89`) y las del gateway ("Conversación", `chat_store.ts:128`) tampoco entran al filtro de `server.ts:104`. |
| F2 | **No se puede copiar ni editar un mensaje** | `app.js:286-306` (`makeMsgEl`/`appendUser`) no renderiza ninguna acción por mensaje. Grep en todo `src/web/public/`: cero usos de `clipboard`. `markdown.js` tampoco pone botón copiar en bloques de código. No existe endpoint de edición/truncado de mensajes. |
| F3 | **Las skills son invisibles al pensar el prompt** | No existe `GET /api/skills` (verificado). El frontmatter de cada skill ya tiene todo lo necesario — `name`, `description`, `trigger_keywords` (`skill_md_parser.ts`) — y el matching por keywords ya existe (`skill_manager.ts:437 getContextSection`), pero nada lo expone a la UI. El usuario solo se entera de que una skill existía cuando ya se activó (`[🧩]` → `skill_activated`). |
| F4 | **Arranque en frío: el dojo vacío no enseña qué pedir** | `index.html:171-173` — el chat vacío muestra un haiku. Bello, pero un novato no sabe si Shinobi puede "ordenar mi carpeta de descargas" o "buscar vuelos". Cero ejemplos cliqueables. |
| F5 | **Fugas técnicas: logs crudos, errores crudos, "ocupado" como error** | El "Rastro" del mensaje es el console.log del server monkey-patcheado (`server.ts:639-671`) — sopa de logs para un novato. Errores se muestran tal cual (`app.js:472-492`). Si envías mientras trabaja: `server.ts:612-615` responde **error** "Shinobi está ocupado" en vez de deshabilitar el envío. |
| F6 | **El candado habla en técnico** | `approval_request` muestra el `promptText` crudo (comando/args) en el modal (`app.js:727-737`). El no técnico debe aprobar algo que no entiende. |
| F7 | *(menor de lo que parece)* **Llegar a la app** | Ya resuelto a medias: `scripts/shinobi_web.ts` detecta pkg, extrae assets a APPDATA, **abre el navegador solo** (`:114-119,225-227`), hay Inno Setup installer y PWA manifest. Queda pulido, no obra. |

---

## 2. Arreglos MENORES (días, riesgo bajo, todo aditivo)

| ID | Arreglo | Dónde | Detalle |
|---|---|---|---|
| M1 | **Título automático robusto** (el bug que reportaste) | `server.ts:95-138` | (a) disparar en el **1er** mensaje (`count >= 1`), no en el 3º exacto; (b) reintentar en cada mensaje siguiente mientras el título siga en el set default {`Conversación nueva`, `Conversación`, `Conversación inicial`}; (c) **fallback heurístico sin LLM** si `routedInvokeLLM` falla: primeras ~6 palabras del primer mensaje del usuario. El broadcast `conversation_title_updated` y `applyAutoTitle` ya existen y funcionan — solo cambia el gatillo. Test vitest del trigger y del fallback. |
| M2 | **Copiar mensaje** | `app.js` + `chat.css` | Icono al hover en cada mensaje (user y agente): `navigator.clipboard.writeText` + feedback "copiado". Añadirlo también en `loadHistory`. |
| M3 | **Copiar bloques de código** | `markdown.js` | Botón en la esquina de cada `<pre>`. Dos líneas de valor enorme cuando Shinobi devuelve comandos o texto largo. |
| M4 | **"Retomar" mensaje (editar v1, sin riesgo)** | `app.js` | Icono en mensajes del usuario → vuelca el texto al composer con foco. No trunca historial (eso es E1): permite corregir y reenviar sin reescribir a mano. Es el 80% del valor con 0% del riesgo. |
| M5 | **Ocupado honesto** | `app.js` | Mientras `pendingAgent` exista: send deshabilitado + placeholder "Shinobi está trabajando en esta misión…". Muere el toast-error reactivo de F5. (El server conserva su guard `busy` igual.) |
| M6 | **Misiones de ejemplo en el dojo vacío** | `index.html` + `app.js` | 4 tarjetas cliqueables bajo el haiku (rellenan el composer): "Ordena los archivos de una carpeta", "Busca X en la web y resúmemelo", "Crea un Word con…", "Vigila esta página y avísame". Curadas a mano, alineadas con skills/tools reales. |
| M7 | **Errores humanizados** | `app.js:472` | Diccionario de patrones → español llano + salida: rate limit → "el proveedor está saturado: espera un momento o cambia de modelo en Ajustes"; key inválida → botón a Ajustes·Proveedor; WS caído ya está bien resuelto ("noche"). El error técnico queda plegado debajo ("ver detalle"). |

**Estimación honesta del bloque M:** 2-4 días de trabajo enfocado, tests incluidos.
M1 es medio día y mata la queja #1 de raíz.

---

## 3. Arreglos MAYORES (1-2 semanas c/u, riesgo medio, siguen siendo aditivos)

### A1 — Habilidades visibles mientras piensas el prompt (tu petición central)

Tres piezas, en orden de valor:

1. **`GET /api/skills`** (nuevo, ~30 líneas): expone del índice in-memory del
   `skillManager` (hoy solo existe `listPending()`, `skill_manager.ts:363`; falta el
   espejo `listApproved()`): `name`, `description`, `trigger_keywords`, `source`.
   Incluye también las desktop skills y, curado a mano, las 5-6 capacidades nativas
   troncales (archivos, shell, navegador Kage, documentos, memoria, sentinel).

2. **Chips vivos en el composer** — la pieza clave: al teclear (debounce ~300ms),
   matching client-side contra `trigger_keywords` (la misma semántica que
   `getContextSection` usa en el server: keywords sobre el input; cero LLM, cero
   coste, cero latencia). Encima del composer aparece:
   `⟡ kage-browser-operator — puede activarse`. El usuario **ve qué sabe hacer
   Shinobi en el momento exacto en que redacta**, y el evento `[🧩]` ya existente
   confirma después la activación real. Ciclo completo: anticipar → confirmar.

3. **Panel "Habilidades"** (drawer desde un botón ⟡ junto al composer, y pestaña
   nueva en Ajustes): tarjetas en lenguaje llano — qué hace, frases que la
   despiertan (keywords legibles), botón "usar" que inserta una plantilla de prompt.
   La paleta "/" (`app.js:564`) y el pergamino Ctrl+/ (`easter_eggs.js`) siguen
   siendo la vía técnica; esto es la vía humana.

### A2 — Rastro en dos capas (humano por defecto, técnico a demanda)

Los datos ya viajan estructurados: `plan` (🧠), `tool_call`, `tool_event` con
`argsPreview`/`durationMs`/`success` (`server.ts:518-520`, `app.js:215-259`).
Cambio solo de presentación: por defecto el mensaje muestra líneas humanas
("leyendo `informe.docx`…", "ejecutando comando · 3.1s ✓") generadas con un
diccionario tool→verbo; el log crudo actual queda plegado en "detalle técnico".
Sin tocar el server.

### A3 — Candado legible

En `showApprovalModal`: plantillas por tool (sin LLM) que anteponen una línea
humana al `promptText` crudo: "Shinobi quiere **ejecutar un comando** en tu
máquina:". El crudo se conserva visible — la verdad ante todo — pero ya no es lo
único. Requiere que el server adjunte `tool` al `approval_request` (campo nuevo
opcional, back-compat).

### A4 — Tour de primera vez (post-onboarding)

`onboarding.html` ya resuelve provider+key. Falta el minuto siguiente: overlay de
4 pasos que traduce las metáforas de marca una sola vez (misión = conversación,
candado = te pedirá permiso, Rastro = lo que está haciendo, ⟡ = sus habilidades)
y ofrece una misión de ejemplo inocua. La marca se conserva; se le da diccionario.

---

## 4. ESTRUCTURALES / pivotes (decisión de producto, tras medir)

| ID | Cambio | Por qué es estructural | Juicio |
|---|---|---|---|
| E1 | **Editar mensaje con truncado real** (v2 de M4) | Exige truncar consistentemente DOS stores: `web_chat.db` (nuevo `deleteMessagesFrom`) **y** la memoria del agente `memory-conv-<id>.json` (`orchestrator.ts:91-106`), pasando por la API de `src/db` y su cola anti lost-update — nunca por fuera. | Hacerlo, pero después de M4 y con tests de consistencia entre stores. |
| E2 | **Streaming real de la respuesta** | Hoy la respuesta llega entera y el typewriter la simula (`app.js:416-425`). Grep en `src/providers/`: no hay streaming. Tocaría provider_router + failover + WS chunks. | Mayor salto de velocidad percibida disponible. Riesgo medio-alto. Fase 3. |
| E3 | **Cola de misiones en vez de rechazo** | El `busy` global + `runExclusive` (`server.ts:558,633`) serializa todo el orchestrator (estado estático + console parcheado). Encolar server-side con posición visible ("tu misión es la 2ª") toca el modelo de concurrencia. | M5 (deshabilitar envío) compra tiempo. Evaluar tras E2. |
| E4 | **Ventana propia / tray** (sentirse "app", no "pestaña") | El exe ya abre el navegador; el paso barato es lanzarlo en modo app (`--app=URL` de Chrome/Edge) + icono en bandeja. Electron/Tauri sería pivote real y hoy **no se justifica**. | Pulido barato sí; pivote no. |

### Anti-pivotes (lo que este plan NO toca, deliberadamente)
- **La marca no se diluye** — misión/rastro/candado/clima se quedan; se les añade
  traducción en el tour (A4), no se reescriben.
- **Nada de frameworks front** (React, etc.): el vanilla JS actual es disciplinado
  y la cultura del repo es CERO dependencia nueva.
- **localhost + navegador se queda** como transporte (el exe ya lo disimula); no
  procede reescritura desktop hoy.
- **SQLite + memory-conv-*.json se quedan**: el modelo de persistencia es sano.

---

## 5. Orden de ejecución

```
Fase 0 (1 día)      M1 título · M5 ocupado · M2 copiar          ← mata tus 2 quejas más urgentes
Fase 1 (semana 1)   M3 · M4 retomar · M6 ejemplos · M7 errores · instrumentación (ver §6)
Fase 2 (sem. 2-3)   A1 habilidades visibles (la petición central) · A2 rastro 2 capas · A3 candado
Fase 3 (mes 2)      A4 tour · E1 edición real · E2 streaming · E3 cola · E4 pulido app
```

Criterio del orden: primero lo que un usuario toca en sus primeros 5 minutos
(títulos, copiar, ocupado), luego lo que decide si vuelve (saber qué puede pedir),
al final lo que exige tocar contratos internos.

## 6. Medir, no opinar (regla del repo)

La telemetría opt-in ya existe (G2.1, `src/telemetry/`). Antes de la Fase 2,
instrumentar 5 contadores: % conversaciones con título ≠ default (objetivo >90%),
usos de copiar/retomar, aperturas del panel ⟡ y envíos precedidos por chip,
errores mostrados al usuario por sesión, tiempo instalación→primera misión
(objetivo <3 min). Cada fase siguiente se prioriza con estos datos, no con
impresiones.

## 7. Inspiración aplicada (de dónde viene cada idea)

- **Claude/ChatGPT**: título al primer intercambio + renombrar manual conservado;
  "editar y reenviar" (E1) con su semántica de truncado.
- **Open WebUI/LM Studio**: generación de título con modelo barato y fallback
  heurístico — exactamente M1.
- **Discord/Notion/Slack**: el autocompletado "/" ya lo tienes; los **chips de
  capacidades en vivo** son su evolución para gente que no sabe que "/" existe.
- **GitHub Copilot / Gemini "suggested actions"**: las tarjetas del dojo vacío (M6).
- **El propio repo**: el patrón "shadow mode" de `src/dispatch` y `src/refiner` —
  los chips ⟡ son shadow mode de cara al usuario: anuncian sin forzar.

---

*Ningún punto de este plan modifica contratos existentes: endpoints nuevos, campos
opcionales, UI aditiva. El gateway/Telegram (`add(sessionId)`) sigue intacto.
Cada bloque ejecutado → tests vitest + typecheck + entrada en DECISIONES.md.*
