# C5 — Skill Index + 3-mode router

Antes de C5, el loop C3 (`improve.ts`) generaba skills nuevas cada vez que detectaba un fallo, incluso si ya había una skill válida en el catálogo. A escala (>100 skills) eso reinventa la rueda y produce duplicados. C5 introduce un **lookup proactivo** vía índice estructurado y bifurca según *confidence*.

## Los 3 modos

```
                       ┌────────────────────┐
                       │  task description  │
                       └─────────┬──────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ findMatchingSkill(task, cat) │
                  │  Jaccard(keywords) + bonuses │
                  └──────────────┬───────────────┘
                                 ▼
                       ┌─────────────────┐
       conf >= 0.70    │   confidence    │   conf < 0.50
       ┌──────────────┤                  ├──────────────┐
       ▼               └─────────┬────────┘              ▼
 ┌───────────┐                   │                ┌──────────────┐
 │  REUSE    │            0.50 ≤ conf < 0.70      │  GENERATE    │
 │           │                   │                │              │
 │ run skill │                   ▼                │ vanilla C3:  │
 │ in sand-  │           ┌──────────────┐         │ N candidates │
 │ box; if   │           │  ENHANCE     │         │ → sandbox    │
 │ PASS,     │           │              │         │ → first PASS │
 │ record    │           │ base_template│         │ approved     │
 │ usage +   │           │ + generator  │         │              │
 │ skill_    │           │ 1st cand =   │         │              │
 │ reused    │           │ existing body│         │              │
 │ in chain  │           │ + N variants │         │              │
 └─────┬─────┘           └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │   parent_skill_id      │   parent_skill_id      │   no parent
       │   = match.skill.id     │   = match.skill.id     │
       └────────────┬───────────┴────────────┬───────────┘
                    ▼                        ▼
            hash chain entry         hash chain entry
        ("skill_reused via X")  ("skill_enhanced parent=X -> Y")
```

## API

```ts
import { findMatchingSkill } from 'opengravity/src/skills/skill_index';

const m = findMatchingSkill('Read app.log and extract emails', 'file');
// { mode: 'reuse' | 'enhance' | 'generate', confidence: 0.91, skill: {...}, reason: '...' }
```

## Confidence

Confidence = `min(1, Jaccard(taskTokens, skillKeywords) + categoryBonus + usageBonus)`.

- `Jaccard`: `|A ∩ B| / |A ∪ B|` sobre tokens normalizados (lowercase, sin stopwords ES/EN, longitud ≥ 2).
- `categoryBonus` = 0.15 si la categoría coincide con `category_hint` derivada del skill.
- `usageBonus` = `min(0.05, usage_count * 0.01)` — un skill ya usado se prefiere ligeramente.

Umbrales:
- **REUSE**: ≥ 0.70 — confiabilidad alta, evitar generación.
- **ENHANCE**: 0.50 ≤ x < 0.70 — base parcial; pasar al generator como base_template.
- **GENERATE**: < 0.50 — vanilla C3.

Override por llamada: `findMatchingSkill(t, c, { reuseAt: 0.80, enhanceAt: 0.60 })`.

## Persistencia

- `data/skill_index.json` — snapshot con timestamp, lista `IndexedSkill[]`, contador `reflection_runs`.
- `data/skill_index_runs.json` — contador de improve runs (gatilla reflection cada 10).

`buildIndex()` regenera desde `getAllSkills()`. `recordUsage(skill_id, run_id)` incrementa `usage_count` tras un REUSE exitoso.

## Reflection loop

`maybeReflectOnRun()` se llama al final de cada `runImprove`. Cada 10 invocaciones:

1. **Duplicate clusters**: skills con mismo `parameters_hash` (sha256 canónico de `parameters_schema`).
2. **Archive candidates**: `usage_count === 0` tras 3+ reflexiones.
3. **Core promotion**: `usage_count >= 5`.

Output: `ReflectionReport` con `recommendations[]` (strings legibles para el log de runImprove).

`runReflection()` también se puede invocar directamente vía `POST /v1/skills/reflect`.

## Endpoints

```
GET  /v1/skills/reflect            -> { stats, state }
POST /v1/skills/reflect            -> { report }
POST /v1/skills/reflect/merge      -> { proposals: [{parameters_hash, skills:[...]}], requires_manual_confirmation: true }
```

`/merge` no ejecuta nada — sólo lista candidatos. La fusión efectiva se hace mediante un workflow manual (no automatizable sin riesgo de pérdida de info).

## Hash chain

C5 añade dos motivos de entrada al ledger:

- `skill_reused via <skill_id> (conf X.XX)`
- `skill_enhanced parent=<parent_id> (conf X.XX) -> <new_id>`

Ambos son entries normales (`verdict: 'PASS'`) — el schema del ledger NO cambia. Cada entry sigue siendo `{run_id, task_id, verdict, reason, duration_ms, ts, prev_hash, entry_hash}` y el `reason` lleva el detalle. **No hay migración**: cualquier herramienta que lee el chain sigue funcionando, simplemente puede parsear `reason` para distinguir.

## Tests

`OpenGravity/src/benchmark/shinobi/__tests__/c5_index.test.ts`:

| Phase | Verifica |
|-------|----------|
| 1 | catálogo vacío → 3 outcomes todos `generate` |
| 2 | lookup contra task description exacta → `reuse`, conf > 0.90 |
| 3 | task similar pero no idéntica → `enhance` o `generate` (no se rompe) |
| 4 | task radicalmente nueva → `generate`, conf < 0.10 |
| 5 | run2 resolved >= run1 resolved (regla parada #1: ≥85% success rate) |

Última corrida:

```
Phase 1 OK — generated 3 skills via GENERATE
exact-match lookup -> reuse conf=0.98
Phase 2 lookups -> reuse(0.98), reuse(0.98), reuse(0.94)
Phase 3 enhance lookup -> generate conf=0.33 (debajo de threshold; correcto)
Phase 4 generate lookup -> generate conf=0.03
Phase 5 success rate 100%
OK
```

Tests previos C3 siguen verdes:
- `baseline.test.ts` → 16/16 PASS, hash chain OK
- `improve.test.ts` → 4/5 (T17 invariante por diseño, sin regresión)

## Compatibilidad y migración

- Sin cambios al schema del catálogo (`SkillEntry`).
- Sin cambios al schema del hash chain.
- Tests existentes verdes sin modificación.
- Si quieres deshabilitar el índice (e.g. para A/B testing), pasa `bypass_index: true` a `runImprove`.
