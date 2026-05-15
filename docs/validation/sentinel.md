# Validación FASE V4.5 — Sentinel

Fecha: 2026-05-15.

## Resumen

Sentinel = vigilancia tecnológica contextual. **Archiva, indexa y
propone — nunca modifica código de Shinobi automáticamente.** Cinco
piezas, todas implementadas, testeadas y validadas E2E.

| Pieza | Módulo | Estado |
|---|---|---|
| 1. Watcher pasivo | `src/sentinel/watcher.ts` | ✅ |
| 2. Indexación semántica | `src/sentinel/indexer.ts` | ✅ |
| 3. Consulta contextual | `src/sentinel/query.ts` | ✅ |
| 4. Council selectivo | `src/sentinel/council.ts` | ✅ |
| 5. Boletín | `src/sentinel/digest.ts` | ✅ |
| Budget cap | `src/sentinel/token_budget.ts` | ✅ |
| Slash command | `src/sentinel/sentinel_command.ts` + `slash_commands.ts` | ✅ |

31 tests vitest + funcional E2E con fuente GitHub real. 921 tests
totales, tsc limpio.

## Diseño

### Pieza 1 — Watcher pasivo
- Fuentes en `config/sentinel/sources.yaml` (vacío al inicio).
- 3 tipos: `github_repo` (GitHub API), `rss` (feed XML), `youtube_channel`
  (RSS público de YouTube — sin API key).
- Detecta items nuevos, persiste `seen.json` por fuente — no re-procesa.
- Archiva en `data/sentinel/raw/<fecha>/<fuente>/<id>.md` con front-matter.
- Transcript: si `durationMinutes > whisper_threshold_minutes` → Whisper
  local (V3); si menos → auto-caption. NO interpreta, solo archiva.

### Pieza 2 — Indexación semántica
- Cada item se indexa en el MemoryProvider activo (`SHINOBI_MEMORY_PROVIDER`)
  con tag `sentinel` + metadata (sourceId, url, fecha, rawPath, duración).
- La búsqueda semántica del provider funciona sin cambios.

### Pieza 3 — Consulta contextual
- `/sentinel ask <tema>` — búsqueda semántica filtrada por tag sentinel,
  top 8 con score + resumen de 2 frases.
- `/sentinel deep <itemId>` — lee el raw completo, extrae propuesta
  estructurada con LLM (título, descripción, área Shinobi, esfuerzo
  S/M/L/XL, riesgos, link). Sin LLM → extracción heurística degradada.
- `/sentinel list <YYYY-MM-DD>` — items archivados desde una fecha.

### Pieza 4 — Council selectivo
- `/sentinel forward <proposalId>` — pasa la propuesta a 3 roles:
  - `arquitecto` — ¿viable técnicamente?
  - `security_auditor` — ¿riesgos?
  - `strategic_critic` — ¿alinea con el posicionamiento de Shinobi? (rol nuevo)
- Mediator: algún `contrario` → REJECT; todos `favorable` → APPROVE;
  mezcla → RESEARCH_MORE.
- Decisión escrita en `docs/sentinel/decisions/<fecha>_<id>.md`.
- **NO se implementa automáticamente** — queda para que el humano firme.

### Pieza 5 — Boletín
- `/sentinel digest [--week|--month]` — resumen de una pantalla: fuentes
  activas, items archivados, decisiones del council.
- Honestidad explícita: si la señal es baja, lo dice. 3 digests sin
  señal → sugiere revisar fuentes.

## Restricciones operativas

- **Budget cap**: `SHINOBI_SENTINEL_TOKEN_BUDGET` (default 50 000
  tokens/semana). Si se cruza, el watcher pausa hasta la siguiente
  ventana. La ventana rota automáticamente cada 7 días.
- **Solo fuentes públicas** — no paywall, no privadas, no login.
- **Sentinel NO modifica código de Shinobi automáticamente.**

## Tests requeridos por el plan — todos cubiertos

| Test exigido | Cubierto en |
|---|---|
| Watcher detecta nuevos sin re-procesar | `sentinel.test.ts` — "primer check archiva todo; segundo check no re-procesa" |
| Whisper local solo si duration > threshold | `sentinel.test.ts` — "video largo usa whisper-local" / "video corto usa auto-caption" |
| `/sentinel ask` ordena por score | `sentinel.test.ts` — "ask devuelve hits ordenados por score descendente" |
| `/sentinel forward` pasa al committee + registra decisión | `sentinel.test.ts` — "forwardToCouncil pasa al committee y registra decisión en disco" |
| Budget cap funciona (simula superar el límite, pausa) | `sentinel.test.ts` — "superar el límite → canProceed false (pausa)" |

## Prueba funcional E2E — evidencia

`scripts/sprintV4_5/run_sentinel_functional.ts`. En modo autónomo se
usó una fuente pública real que no necesita API key: el repo GitHub
`ggml-org/whisper.cpp`.

```
--- 1. /sentinel watch (fuente GitHub real) ---
  · whisper.cpp releases: 25 nuevos, 0 ya vistos
  Watcher OK · 25 items nuevos archivados e indexados

--- 3. /sentinel ask "transcripción audio whisper modelo" ---
  Top 8 para "...": [0.03] v1.5.4, [0.02] v1.6.2, ...

--- 4. /sentinel deep ---
  Propuesta extraída: prop_2070a70f8b
    Título: Adoptar mejoras de whisper.cpp en el STT de Shinobi
    Área:   src/stt/whisper_cpp_provider.ts · Esfuerzo: M

--- 5. /sentinel forward (council) ---
  Veredicto del council: APPROVE
    arquitecto / security_auditor / strategic_critic → favorable
  Decisión registrada en docs/sentinel/decisions/.

--- 6. /sentinel digest ---
  Fuentes activas: 1 · Items archivados: 25 · Decisiones: 1

PASS · Sentinel E2E: watch real + index + ask + deep + forward + digest
```

El watcher hizo **red real** contra la GitHub API (25 releases reales
de whisper.cpp archivadas). Indexación + ask con `InMemoryProvider`
(text search determinista). deep/forward con LLM stub determinista
(valida el cableado del pipeline, no la calidad del LLM — eso lo
cubren los tests con JSON real-shaped).

## Uso

```bash
# 1. Edita config/sentinel/sources.yaml con tus fuentes públicas.
# 2. Chequea + indexa:
/sentinel watch
# 3. Consulta:
/sentinel ask loop detection en agentes
/sentinel list 2026-05-01
/sentinel deep <itemId>
# 4. Pasa una propuesta al council:
/sentinel forward <proposalId>
# 5. Boletín:
/sentinel digest --week
```

## Notas

- `config/sentinel/sources.yaml` se versiona (template vacío);
  `data/sentinel/` es runtime y está gitignored.
- El parser de `sources.yaml` y de RSS/Atom es propio y mínimo — no se
  añadió ninguna dependencia nueva.
- La prueba funcional manual del plan (Iván añade un canal de YouTube)
  se puede reproducir editando `sources.yaml` con un `youtube_channel`
  y corriendo `/sentinel watch`.
