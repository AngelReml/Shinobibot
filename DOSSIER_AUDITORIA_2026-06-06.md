# Dossier de Auditoría — Shinobibot

**Fecha:** 2026-06-06
**Alcance:** `C:\Users\angel\Desktop\shinobibot` — análisis estático sobre código crudo (`src/`, `scripts/`, config).
**Método:** lectura directa de fuentes + `tsc --noEmit` + grep dirigido. Todo lo afirmado aquí está confirmado contra el código, no contra documentación previa.

> Nota: existe un `ERROR_REPORT.md` de 2026-04-07. Este dossier lo **reemplaza y corrige**: varios de sus "críticos" ya no aplican porque el `orchestrator.ts` fue refactorizado. Se indica caso por caso.

---

## 1. Características reales confirmadas (datos crudos)

Esto es lo que el código **realmente** contiene hoy, verificado archivo por archivo:

- **Tamaño real:** 513 archivos `.ts` en el repo. Núcleo en `src/` (~11 MB de fuente), 158 scripts `.ts` en `scripts/`.
- **Stack confirmado** (`package.json`): Node 22 ESM + TypeScript 5, `openai`, `playwright` (CDP), `better-sqlite3`, `grammy` (Telegram), `express`, `isolated-vm`, `@nut-tree-fork/nut-js` (control de pantalla), `docx`/`exceljs` (generación de documentos), `ws`. Empaquetado a `.exe` Windows vía `@yao-pkg/pkg` (target `node22-win-x64`).
- **Arquitectura confirmada:** loop orquestador (`src/coordinator/orchestrator.ts`, ~43 KB) → providers con failover (`src/providers/provider_router.ts`: OpenGravity → OpenRouter → Groq → OpenAI → Anthropic) → registry de 39 archivos que llaman `registerTool` en `src/tools/`.
- **Tool de shell maduro** (`src/tools/run_command.ts`): blacklist por regex con límites de palabra, normalización anti-evasión (quita `'"`^` antes de testear), allowlist de líderes read-only (`git`, `tsc`), exclusión deliberada de `node`/`npx` por ser arbitrarios. Muy por encima del `includes()` que describía el reporte de abril.
- **Sandbox multi-backend** (`src/sandbox/`): `local`, `docker`, `ssh`, `e2b`, `mock`. Selección por `SHINOBI_RUN_BACKEND`, default `local`, **sin fallback silencioso** (decisión correcta y documentada en el propio registry).
- **Memoria dual:** `src/db/memory.ts` (JSON en `memory.json`) + `src/memory/memory_store.ts` (SQLite + embeddings) + curated memory (`USER.md`/`MEMORY.md`).
- **Subsistemas presentes y con código real:** committee multi-modelo, loop detector, skills firmadas SHA256, multiuser (owner/collab/guest), A2A con HMAC, observability, backup de estado, self-debug heurístico.

### Desajustes documentación ↔ código (no son bugs, pero engañan)

| Afirmación en docs | Realidad en código |
|---|---|
| `ARCHITECTURE.md`: "Tool Registry (34 tools)" | 39 archivos registran tools |
| `ARCHITECTURE.md`: "LoopDetector v2" | `README.md` dice v3; conviven ambas etiquetas |
| `README.md`: "tests 953 passing" (badge) | No verificable estáticamente; el badge es manual, no de CI |
| `registry.ts` docstring: backends "modal, daytona" | **No existen** esos archivos (ver §2-B3) |

---

## 2. Bugs, mocks y riesgos de producción (confirmados)

Severidad: 🔴 alta · 🟠 media · 🟡 baja. Cada hallazgo cita archivo:línea real.

### 🔴 B1 — `ContradictionFilter` está roto y se usa en producción
- **Archivo:** `src/memory/contradiction_filter.ts:51-56`
- **Evidencia cruda:** llama `invokeLLM([...])` pasándole un **array**, pero la firma real (`src/providers/provider_router.ts:101`) espera `LLMChatPayload` = `{ messages: [...] }`. Luego lee `response.content`, pero el tipo de retorno es `CloudResponse` = `{ success, output, error }` — **no tiene `.content`**.
- **Consecuencia:** `(response.content || '').trim()` siempre da `''`. Como `''` nunca incluye `"NO_CONFLICT"`, el filtro **reporta un falso conflicto en cada llamada**.
- **Impacto real:** `ContradictionFilter.check()` se invoca en producción en `src/memory/curated_memory.ts:281, 319, 368` al escribir hechos/notas en la memoria curada. El path LLM degrada silenciosamente cada escritura.
- **Confirmado por:** `tsc --noEmit` → TS2345 + TS2339. Patrón correcto visible en `slash_commands.ts:655` (`invokeLLM({ messages: [...] })` y lee `.output`).
- **Fix:** `const response = await invokeLLM({ messages: [...] }, { tier: 'fast' }); const reply = (response.output || '').trim();`

### 🔴/🟠 B2 — Secretos reales en `.env` (mitigado en git, no en disco)
- **Archivo:** `.env`
- **Evidencia:** 8 claves reales en texto plano: `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `SHINOBI_API_KEY`, `MEM0_API_KEY`, `SUPERMEMORY_API_KEY`, `MATRIX_ACCESS_TOKEN`.
- **Bueno:** `.env` **sí** está en `.gitignore` y **no** está trackeado por git (`git ls-files` lo confirma). El crítico C1 del reporte de abril ya **no aplica a git**.
- **Riesgo vivo:** las claves siguen en disco en claro. Si compartes la carpeta (como ahora), backups, o el `.exe` empaquetado las arrastra, se filtran. **Rota las claves** que hayan estado expuestas y trata el `.env` como secreto.

### 🟠 B3 — Referencias a módulos inexistentes (crash en runtime)
- **`scripts/shinobi.ts:120,130`** importa `../src/demo/demo_runner.js`. **`src/demo/` no existe.** El comando `shinobi run-demo …` revienta con *module not found*.
- **`scripts/audit_validation/p2_modal_daytona_real.ts:9-10`** importa `backends/modal.js` y `backends/daytona.js`. **No existen** (solo hay local/docker/ssh/e2b/mock). Script muerto + docstring de `registry.ts` que promete backends que nunca se implementaron.
- **Confirmado por:** `tsc` → TS2307 (4 ocurrencias).

### 🟡 B4 — Indexado de `RegExpMatchArray` sin null-check
- **Archivo:** `src/web/server.ts:509`
- **Evidencia:** `toolMatchAscii` queda tipado `false | RegExpMatchArray`; el `?.[1]` salva el runtime, pero TS marca TS7053. Funciona hoy, frágil ante refactor.

### 🟡 B5 — `await` faltante / lectura de Promise
- **Archivo:** `scripts/audit_validation/markdown_memory_real.ts:68,70` — lee `.ok`/`.message` sobre un `Promise` sin `await` (TS2339 x4). Script de validación, no afecta runtime de producción, pero el test "valida" sobre un objeto Promise → da falsos verdes.

### 🟡 B6 — Imports `.mjs` sin tipos (implicit any)
- `scripts/shinobi.ts:100,112` y `src/coordinator/slash_commands.ts:67` importan skills `.mjs` sin declaración → `any` implícito (TS7016). Pierdes type-safety en el cargador de skills.

### ✅ Mock NO es un riesgo de producción
- `src/sandbox/backends/mock.ts` existe, **pero `registry.ts:36` lo excluye a propósito del registro por defecto** ("lo añaden los tests"). Bien hecho. De los 261 hits de `mock/fake/stub`, la inmensa mayoría están en tests y scripts de sprint, no en el runtime.

### Estado de los "críticos" de abril 2026
| Reporte abril | Estado hoy (verificado) |
|---|---|
| C1 claves en `.env` | Parcial: ya gitignored/no trackeado; siguen en disco (B2) |
| C2 inyección shell en orchestrator | **Resuelto**: `orchestrator.ts` ya no hace `exec()`/pip-install interpolado (0 ocurrencias) |
| C3 eval de código LLM sin validar | No reproducible en `orchestrator.ts` actual; ejecución pasa por `run_command` con blacklist |
| C4 import a `ShinobiOrchestrator.ts` | **Resuelto**: `executor.ts`/`test_jwt.ts` son ahora stubs `export {}` |
| C5 método `executeTask()` inexistente | **Resuelto** (mismos stubs) |

---

## 3. Propuesta de mejora

**Prioridad inmediata (esta semana):**

1. **Arreglar B1.** Es el único bug que corrompe datos en caliente (memoria curada). Cambio de 2 líneas. Añadir un test que verifique que un `NO_CONFLICT` real se parsea como `hasConflict: false`.
2. **Rotar y blindar secretos (B2).** Rotar las 8 claves, confirmar que el empaquetado `.exe` no embebe `.env`, y añadir un pre-commit hook que rechace claves en claro.
3. **Resolver imports muertos (B3).** O crear `src/demo/demo_runner.ts`, o quitar el comando `run-demo` de `scripts/shinobi.ts`. Borrar `p2_modal_daytona_real.ts` o implementar los backends. Limpiar el docstring de `registry.ts`.

**Higiene de calidad (este mes):**

4. **`tsc --noEmit` en CI como gate bloqueante.** Hoy hay 14 errores de tipo que el repo tolera. Una vez en cero, ningún merge debería reintroducirlos. Esto solo habría atrapado B1, B3, B4, B5 y B6 automáticamente.
5. **Sincronizar docs con código** (conteo de tools, versión del loop detector, badge de tests) o, mejor, **generarlos** desde el código para que no vuelvan a divergir.
6. **Decidir el destino de la memoria dual** (`src/db/memory.ts` JSON vs `src/memory/memory_store.ts` SQLite): documentar la frontera o consolidar. Hoy coexisten sin contrato claro.

**Estructural (backlog):**

7. **Endurecer más allá del blacklist en `run_command`.** El blacklist por regex es bueno pero por naturaleza es evadible; para el modo autónomo, empujar la ejecución hacia el sandbox aislado (docker/e2b) por defecto cuando `SHINOBI_AUTONOMOUS=1`.
8. **Cobertura de tipos en el cargador de skills** (`.mjs` → `.d.ts` o migrar a `.ts`).

---

## 4. Código escrito pero inútil / viejo / obsoleto / solapado

Confirmado por inspección y por ausencia de referencias desde `src/`.

**Archivos `.bak` (8) — basura de respaldo, borrar:**
- `src/coordinator/orchestrator.ts.bak` (40 KB), `src/web/server.ts.bak`, `src/tools/web_search.ts.bak`, `scripts/executor.ts.bak`, `scripts/test_jwt.ts.bak`, `src/web/public/js/app.js.bak`, `src/web/public/js/markdown.js.bak`, `src/web/public/styles/chat.css.bak`

**Stubs vacíos — código que fue vaciado pero sigue ahí:**
- `scripts/executor.ts` y `scripts/test_jwt.ts` → ahora solo `export {}`. Eliminar junto a sus `.bak`.

**Scripts de sprint/validación one-off (86 archivos `.ts`) — desarrollo histórico:**
- Todo `scripts/sprint*/` (sprint1_1 … sprintV6) y `scripts/audit_validation/`. **Ningún `src/` los referencia** (grep vacío). Son scripts de validación manual de hitos pasados. Recomendación: mover a un dir `archive/` fuera del build o eliminar; hoy inflan el repo y confunden qué es producción.

**Referencias rotas / código aspiracional nunca implementado:**
- `src/demo/demo_runner.js` — referenciado en `scripts/shinobi.ts`, no existe.
- `backends/modal.js` y `backends/daytona.js` — prometidos en el docstring de `registry.ts` y en `p2_modal_daytona_real.ts`, nunca escritos.

**Posible solapamiento (revisar, no eliminar a ciegas):**
- Memoria JSON (`src/db/memory.ts`) vs SQLite (`src/memory/memory_store.ts`): dos sistemas de persistencia de memoria conviviendo. Verificar si el JSON es legacy reemplazable por el store SQLite.
- Dos rutas de detección de contradicciones: `ContradictionFilter` (clase LLM, rota — B1) y `detectContradictions()` heurístico en `src/context/memory_reflector.ts` (sí usado en `orchestrator.ts:173`). Solapan en intención.

---

## Addendum — Implementación (2026-06-06, misma sesión)

Todo lo accionable del dossier quedó **implementado**:

| Ítem | Acción | Archivos |
|---|---|---|
| B1 | `invokeLLM({messages})` + `.output` + throw→fallback heurístico | `src/memory/contradiction_filter.ts` |
| B3 | `run-demo` degrada con mensaje claro; script modal/daytona borrado; docstring limpio | `scripts/shinobi.ts`, `src/sandbox/registry.ts` |
| B4 | `toolMatchAscii` ahora `null`-safe | `src/web/server.ts` |
| B5 | `await` añadidos | `archive/scripts/audit_validation/markdown_memory_real.ts` |
| B6 | Declaración ambiental `*.mjs` tipada | `src/types/mjs_modules.d.ts` (nuevo) |
| Muertos | 8 `.bak` + 2 stubs borrados; 31 dirs sprint → `archive/` (excluido en tsconfig) | `tsconfig.json`, `archive/README.md` |
| Docs | LoopDetector v2→v3, 34→41 tools | `ARCHITECTURE.md` |
| CI | Gate `tsc --noEmit` estricto sin filtros | `.github/workflows/ci.yml` |
| Secretos | Hook pre-commit anti-claves + `core.hooksPath` activado | `.githooks/pre-commit` |

**Solución al problema "no usa tools/skills por lenguaje natural" (3 causas raíz encontradas):**

1. **Matching de skills era substring exacto** → reescrito en `skill_manager.ts#getContextSection`: normaliza acentos, tolera singular/plural y variación morfológica, keywords multi-palabra matchean en cualquier orden, ranking por nº de hits. Validado con 9 casos de prueba (9/9 PASS). Cada activación se loguea: `[🧩] Skill activada: X (trigger: …)`; con `SHINOBI_SKILL_DEBUG=1` también loguea cuando nada matchea.
2. **El system prompt enumeraba solo 8 de las 41 tools** → `prompts.ts` ahora lista el catálogo por categorías, añade la **TOOL-FIRST RULE** (ante intención accionable, llamar la tool, sin exigir nombrarla) y el **PLAN PROTOCOL** (el modelo emite `PLAN: objetivo → tools` antes del primer tool call).
3. **El razonamiento del modelo junto a sus tool_calls nunca se imprimía** → `orchestrator.ts` ahora lo muestra como `[🧠] …` (truncado a 300 chars) y `server.ts` lo reenvía al WebChat con tipos propios `plan` y `skill_activated` para render destacado.

Pendiente de validar en tu máquina (el sandbox de esta sesión no pudo correr el typecheck sobre los archivos finales): `npm run typecheck` y `npx vitest run src/memory/__tests__/contradiction_filter.test.ts`.

**No automatizable desde aquí:** rotar las 8 claves del `.env` (hazlo en cada dashboard).

---

## Resumen de una línea

El núcleo está mucho más sano que en abril (los 5 "críticos" viejos casi todos resueltos). El riesgo real activo es **un solo bug** (`ContradictionFilter`, B1) que corrompe la memoria curada en silencio, más **secretos en claro** y **~94 archivos de código muerto** (8 `.bak` + 86 scripts de sprint) que conviene podar.
