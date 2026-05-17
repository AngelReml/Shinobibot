# Plan de implementación — Bucle de aprendizaje (Hermes → Shinobi)

> Fuente: `hermes-agent-main/mapa.md` (auditoría de hermes-agent v0.14.0) +
> conocimiento directo del código de Shinobi (5 ciclos de auditoría).
> Fecha: 2026-05-17.

## 1. Resumen ejecutivo

Hermes "aprende de cada conversación" con **dos motores + una capa pasiva**:

- **Motor 1 — Background Review**: tras cada turno, si salta un *nudge*,
  forkea un agente barato que se pregunta "¿guardo memoria? ¿actualizo una
  skill?". Es la red de seguridad del aprendizaje.
- **Motor 2 — Curator**: en idle, cada ~7 días, consolida skills estrechas
  en skills "paraguas" para que la librería no muera por proliferación.
- **Capa pasiva**: telemetría sidecar por skill (view/use/patch) que
  alimenta al Curator.

**Shinobi ya tiene la mitad de las piezas**, pero ninguna de las dos
nucleares. Lo que falta no es construir de cero — es **completar y unificar**.

## 2. Comparación Hermes ↔ Shinobi

| Pieza de Hermes | Equivalente en Shinobi | Veredicto |
|---|---|---|
| Motor 1 — review de memoria (fork LLM post-turno) | `src/context/memory_reflector.ts` — pero usa **heurísticas regex**, NO un fork LLM | 🟡 reemplazar el motor |
| Motor 1 — review de skills (fork LLM post-turno) | `skill_manager.evaluateAndPropose` — LLM real, pero disparado por *fallo* o *patrón*, no por nudge post-turno | 🟡 existe parcial; falta el nudge unificado |
| Motor 2 — Curator (consolidación de skills) | nada (el `DreamingEngine` consolida *memoria*, no skills) | 🔴 falta entero |
| Telemetría sidecar de skills (view/use/patch) | `usage_pattern_detector` cuenta secuencias de tools; no hay contadores por-skill | 🔴 falta |
| Provenance `created_by=agent` (gate de curación) | `skill_manager` tiene `source_kind` (`manual`/`failure`/`pattern`) | 🟡 base hecha; falta el gate |
| `session_search` (FTS5 sobre transcripts) | `MemoryStore` (recall vectorial por embeddings); `Memory` solo guarda 30 turnos | 🟡 Shinobi tiene recall vectorial — distinto, no peor |
| Separación memoria / skills / sesiones | 4 capas de memoria solapadas (`Memory`, `MemoryStore`, `CuratedMemory`, `MemoryProviderRegistry`) | 🔴 deuda arquitectónica (ya señalada por la auditoría) |
| Los 3 prompts de review + lista negra | `memory_reflector` usa `PREF_PATTERNS` regex | 🔴 falta — esto es "el oro" |
| Fork hereda el prompt cacheado (~26% menos coste) | no hay fork | 🔴 falta (depende de la Fase 1) |
| Tools `memory` / `skill_manage` single-entry | `request_new_skill` + slash `/skill` + `skill_list` | 🟡 funciona; el schema action-tool es más limpio |
| Formato skill: paraguas + `references/templates/scripts` | `installer.ts` ya valida esos subdirs; SKILL.md + firma + auditor | 🟢 formato OK; falta el *sesgo a paraguas* |

**Lo que Shinobi hace mejor y hay que conservar:** firma + auditoría
criptográfica de skills (C8/C9/C10), recall vectorial por embeddings,
`orchestrator_mutex`, el gate de aprobación, `self_debug` (diagnóstico de
fallos de tool), `usage_pattern_detector` (patrón→skill).

## 3. Qué reutilizar / qué construir

**Reutilizar tal cual:**
- `CuratedMemory` (`src/memory/curated_memory.ts`) — es ya el USER.md/
  MEMORY.md de Hermes. Es el store de memoria declarativa.
- `skill_manager.runProposal` / `proposeSkill` — ya sabe generar un
  SKILL.md vía LLM y dejarlo en `skills/pending/`.
- `skill_loader` / `skill_auditor` / `skill_signing` — firma + auditoría.
- `resident_loop.ts` — ya es el lazo idle 24/7 con hook de dreaming.
- `model_router` — para elegir el modelo auxiliar barato del review/curator.
- El formato SKILL.md + subdirs `references/templates/scripts` (ya válido
  en `installer.ts`).

**Construir nuevo:**
- `src/learning/background_review.ts` — Motor 1 (el fork de review).
- `src/learning/review_prompts.ts` — los 3 prompts + la lista negra.
- `src/learning/skill_curator.ts` — Motor 2.
- `src/learning/skill_telemetry.ts` — la capa pasiva (`.usage.json`).
- Contadores de nudge en el orchestrator.

---

## 4. Plan por fases

Orden por impacto (lo de arriba mueve más la aguja — sigue el checklist §8
del mapa).

### Fase 1 — Background Review (Motor 1) · IMPACTO MÁXIMO

**Objetivo:** tras cada misión, si saltó un nudge, ejecutar una revisión
LLM acotada que decida guardar memoria y/o actualizar skills.

Shinobi no forkea `AIAgent`s como Hermes; el equivalente es un **bucle de
tools acotado** con el modelo auxiliar barato.

**Crear `src/learning/background_review.ts`:**
- `runBackgroundReview({ messagesSnapshot, reviewMemory, reviewSkills })`.
- Usa `routedInvokeLLM` con el modelo auxiliar (`model_router`, tier barato
  o env `SHINOBI_REVIEW_MODEL`).
- **Whitelist de tools**: solo `memory`/`skill_manage` (Fase 8) o, hasta
  esa fase, solo permite invocar `skill_manager.proposeSkill` y
  `curatedMemory().appendEnv/...`. Todo lo demás denegado.
- `maxIterations` bajo (~16). Best-effort: try/catch global, nunca rompe.
- Se ejecuta **después** de entregar la respuesta — en Shinobi, en el
  `finally` de `ShinobiOrchestrator.process()` (donde hoy ya se invoca el
  `MemoryReflector`). NO bloquear al usuario: lanzar sin `await` o con un
  `setImmediate`, y serializar con `runExclusive` para no chocar con la
  siguiente misión.
- El review **no se revisa a sí mismo**: marca un flag para que su propia
  ejecución no incremente los contadores de nudge.
- Al terminar, una línea compacta al usuario:
  `💾 Self-improvement: memoria actualizada · skill 'x' creada`.

**Contadores de nudge** (en `ShinobiOrchestrator`, estáticos):
- `_turnsSinceMemory` (++ por misión de usuario), nudge a 10.
- `_itersSinceSkill` (++ por iteración del tool-loop, en `executeToolLoop`),
  nudge a 15, **reset cuando el agente usa skill_manage en vivo**.
- **Rehidratación**: como `process()` es efímero por mensaje, al arrancar
  rehidratar desde el conteo de turnos de `Memory` (`memory.json`):
  `_turnsSinceMemory = priorUserTurns % nudgeInterval`. Sin esto el nudge
  nunca salta.

**Reemplaza** la heurística regex de `MemoryReflector` por esta revisión
LLM (o deja el reflector como pre-filtro barato y el fork como decisor).

**Reuso del cache de prompt (~26% coste):** el review debe heredar el
system prompt del padre verbatim para pegar al mismo prefix-cache. En
Shinobi: pasar el mismo `currentMessages[0]` (system) que usó la misión.

**Validación real (a):** una conversación de prueba con una corrección de
estilo del usuario → el review crea/parchea una skill; un dato personal →
escribe a `CuratedMemory`. Log real pegado.

**Esfuerzo:** alto. Es el corazón. ~2-3 días.

### Fase 2 — Los 3 prompts de review + lista negra · IMPACTO ALTO

**Objetivo:** copiar casi literal los prompts de Hermes — son "el oro".

**Crear `src/learning/review_prompts.ts`** con:
- `MEMORY_REVIEW_PROMPT`, `SKILL_REVIEW_PROMPT`, `COMBINED_REVIEW_PROMPT`
  (mapa §1.3 — copiar el texto).
- La **lista negra** (crítica): NO capturar como skill fallos de entorno
  ("command not found", credencial sin configurar), afirmaciones negativas
  sobre tools ("X no funciona" → se endurece en rechazos que el agente se
  cita meses), errores transitorios, narrativas one-off.
- El **sesgo a la acción**: "la mayoría de sesiones producen al menos una
  actualización de skill; no hacer nada es una oportunidad perdida".
- "La frustración del usuario con tu estilo es una señal de skill de
  primera clase" — no solo memoria.

**Validación:** un caso de la lista negra (un `command not found` en la
conversación) → el review NO crea una skill "tool X roto". Test real.

**Esfuerzo:** bajo (es texto). ~medio día. Hacer junto con Fase 1.

### Fase 3 — Separación memoria / skills / sesiones · IMPACTO ALTO

**Objetivo:** tres stores, tres reglas. Hoy Shinobi tiene 4 capas de
memoria solapadas (deuda ya señalada en la auditoría).

- **Memoria declarativa** = `CuratedMemory` (USER.md/MEMORY.md). El review
  escribe SOLO hechos declarativos aquí. Regla: "el usuario prefiere
  respuestas concisas" ✓ — "responde siempre conciso" ✗ (imperativo se
  re-lee como directiva y pisa la petición actual).
- **Skills** = procedimientos. `skills/approved/`.
- **Sesiones/recall** = `MemoryStore` (recall vectorial) + `Memory`
  (turnos). Decisión de producto: ¿añadir FTS5 sobre transcripts (como
  Hermes) o aceptar que el recall vectorial cubre el caso? Recomendación:
  el recall vectorial de Shinobi ya es suficiente; documentar que "qué
  hicimos la semana pasada" se resuelve con `MemoryStore.recall`, no con
  memoria declarativa.
- **Clarificar el rol de las 4 capas** o fusionarlas: `Memory` (turnos
  efímeros) + `MemoryStore` (recall) + `CuratedMemory` (declarativa). El
  `MemoryProviderRegistry` externo queda ortogonal/opcional.

**Esfuerzo:** medio — sobre todo decisión + documentación + ajustar qué
escribe el review en cada una. ~1 día.

### Fase 4 — Telemetría sidecar de skills · IMPACTO MEDIO

**Objetivo:** contadores por-skill que alimentan al Curator.

**Crear `src/learning/skill_telemetry.ts`:**
- Sidecar JSON `skills/.usage.json`, keyed por nombre de skill.
- Registro: `{ created_by, use_count, view_count, patch_count,
  last_used_at, last_viewed_at, last_patched_at, created_at, state, pinned,
  archived_at }`.
- `bumpUse()` — cuando una skill se inyecta al prompt o se referencia.
- `bumpView()` — desde el `/skill <name>` o el equivalente skill_view.
- `bumpPatch()` — desde `skill_manage` patch/edit.
- Escritura atómica (temp + rename) — Shinobi ya tiene este patrón
  (`atomicWrite` en `db/memory.ts`). Best-effort: un sidecar roto nunca
  rompe el tool.
- Cablear los `bump*` en `skill_loader` (carga), `skill_manager` (patch),
  y el handler `/skill`.

**Esfuerzo:** medio. ~1 día.

### Fase 5 — Provenance + gate de curación · IMPACTO MEDIO

**Objetivo:** que el Curator SOLO toque skills nacidas del agente, nunca
las del usuario ni las bundled.

- Extender el `source_kind` que ya tiene `skill_manager`: marcar
  `created_by: "agent"` en `.usage.json` SOLO cuando la skill nace del fork
  de background review (Fase 1).
- Skills creadas por `/skill propose` manual del usuario → `created_by:
  "user"` → el Curator NO las toca.
- Skills firmadas/instaladas vía registry → off-limits.
- `list_agent_created_skill_names()` → la lista de candidatos del Curator.

**Esfuerzo:** bajo (se apoya en `source_kind`). ~medio día.

### Fase 6 — Skill Curator (Motor 2) · IMPACTO MEDIO

**Objetivo:** consolidar skills estrechas en paraguas. Sin esto, la Fase 1
produce cientos de skills inservibles.

**Crear `src/learning/skill_curator.ts`:**
- **Disparo por idle**, NO cron. Cablear en `resident_loop.ts` (que ya
  corre el `dreaming` idle). Gate: `enabled`, no pausado, `last_run_at`
  más viejo que `intervalHours` (default 168 = 7 días), idle ≥ `minIdle`.
  First-run: NO corre — siembra `last_run_at` y difiere.
- **Fase A — transiciones automáticas (sin LLM):** ancla = última
  actividad. `>90d` → archivar; `>30d` y `active` → `stale`; reactivar si
  se volvió a usar. Skills `pinned` se saltan.
- **Fase B — consolidación LLM:** el modelo auxiliar barato recibe el
  `CURATOR_REVIEW_PROMPT` (mapa §2.3 — copiar) con la lista de candidatos
  agent-created. Detecta *prefix clusters*, construye paraguas.
- **NUNCA borra** — archiva a `skills/.archive/<skill>/` (recuperable). El
  Curator alucina; hace falta undo.
- Reescribir refs: si una skill se consolida, actualizar referencias
  (misiones recurrentes que la citen).
- Reportes a disco: `logs/curator/<timestamp>/run.json` + `REPORT.md`.
- Estado en `skills/.curator_state` (JSON).

**Esfuerzo:** alto. ~2 días.

### Fase 7 — Sesgo a skill paraguas · IMPACTO BAJO

El formato (subdirs `references/templates/scripts`) ya está en
`installer.ts`. Lo que falta es **sesgar los prompts de autoría** (Fase 2
y el guidance del system prompt) hacia: una skill ancha con subsecciones
etiquetadas > cinco skills estrechas. Editar el `SKILL_REVIEW_PROMPT` y el
guidance permanente.

**Esfuerzo:** bajo — texto. Se hace con la Fase 2/6.

### Fase 8 — Action-tools `memory` y `skill_manage` · IMPACTO BAJO (opcional)

Refactor opcional: unificar `request_new_skill` + lo que use el review en
un único tool `skill_manage` con parámetro `action`
(create/patch/edit/delete/write_file), y un tool `memory` con `action`
(add/replace/remove) + `target` (memory/user). Reduce el bloat del schema
en el prompt cacheado. Esquemas exactos en el mapa §10.

**Esfuerzo:** medio. Hacer solo si el prompt cacheado pesa demasiado.

---

## 5. Pitfalls (los que Hermes ya pagó por descubrir — no repetir)

1. **No capturar fallos de entorno ni "tool X roto" como skill** → se
   endurecen en rechazos que el agente se cita a sí mismo durante meses.
   La lista negra de la Fase 2 es la defensa.
2. **No borrar skills nunca** — archivar a `.archive/` recuperable.
3. **No usar `use_count` como señal de valor** — los contadores empiezan
   en 0; ausencia de evidencia ≠ evidencia de ausencia.
4. **Memoria en modo declarativo, nunca imperativo** — "siempre haz X" se
   re-lee como directiva y pisa la petición actual.
5. **No meter PR numbers / SHAs / "Fase N hecha" en memoria** — stale en
   7 días.
6. **El review y el curator usan el modelo auxiliar barato**, no el
   principal — corren seguido / largo.
7. **El review no se revisa a sí mismo** — sin esto, recursión infinita.
8. **Centralizar quién escribe el store de aprendizaje**: el agente
   foreground aprende; los subagentes ejecutan. Un enjambre escribiendo
   memoria/skills en paralelo produce basura. (Shinobi: el
   `orchestrator_mutex` ya ayuda; respetarlo.)

## 6. Superficie de configuración (nueva)

```
SHINOBI_REVIEW_ENABLED=1            # Motor 1 on/off
SHINOBI_MEMORY_NUDGE_INTERVAL=10    # turnos entre memory reviews
SHINOBI_SKILL_NUDGE_INTERVAL=15     # iteraciones entre skill reviews
SHINOBI_REVIEW_MODEL=<modelo aux>   # modelo barato del review
SHINOBI_CURATOR_ENABLED=1
SHINOBI_CURATOR_INTERVAL_HOURS=168
SHINOBI_CURATOR_MIN_IDLE_HOURS=2
SHINOBI_CURATOR_STALE_DAYS=30
SHINOBI_CURATOR_ARCHIVE_DAYS=90
```

Estado en disco: `skills/.usage.json`, `skills/.curator_state`,
`skills/.archive/`, `logs/curator/`.

## 7. Secuenciación y dependencias

```
Fase 1 (review fork) ──┬──> Fase 2 (prompts)      [hacer juntas]
                       └──> Fase 3 (separación stores)
Fase 4 (telemetría) ───────> Fase 5 (provenance) ──> Fase 6 (curator)
Fase 7 (paraguas) ─── con Fase 2/6
Fase 8 (action-tools) ─ opcional, cuando se quiera
```

**Ruta crítica:** Fase 1+2 primero (es el bucle de aprendizaje en sí — sin
esto no hay nada). Fase 4→5→6 después (mantenimiento de la librería).
Fase 3 en paralelo. Fase 7/8 son pulido.

**Mínimo viable:** Fases 1+2+3. Con eso Shinobi "aprende de cada
conversación" — que es el objetivo. Las Fases 4-6 evitan que la librería
de skills se degrade con el tiempo; son necesarias a medio plazo pero no
para el primer valor.

## 8. Regla de validación

Cada fase se cierra con prueba real categoría (a): ejecución del código
real contra dependencias reales, resultado observable. Un harness
`scripts/audit_validation/learning_*.ts` por fase, con el log real pegado
en el commit. Nada se da por hecho con solo tests unitarios.
