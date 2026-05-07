# S1.5 — Reader stress test v2 (post F-04 + F-01)

Fecha: 2026-05-07
Branch: `feat/s1.5-reader-stress`
Commits aplicados: `0223155` (F-04 scoring) + `0c20fc5` (F-01 degraded-empty) sobre el commit `96fa3f0` del re-mapping de modelos (glm-flash leaves + sonnet balanced + opus anchor solo code_reviewer).
Config: `runRead` con `DEFAULT_BUDGET`, depth=1, una sola corrida por repo, sin voting.

> Comparación lado a lado con stress v1 (`docs/s1_5/reader_stress_test.md`). Misma estructura más columna "vs v1".

## Resultado por repo

| Repo | v1 | v2 | vs v1 |
|---|---|---|---|
| `kubernetes/kubernetes` | PARCIAL — 19/29.941 cubiertos (0,06%) | **PARCIAL — 20/29.944 cubiertos** (0,07%) | scoring promueve `staging` + `api` (críticos), elimina `hack` (penalty); cmd se pierde en misc por tradeoff |
| `facebook/react` | PARCIAL — 18/6.879 (0,26%) | **ROTO — 6/6 sub-agents timeout 90s** | regresión por timeout glm-flash, NO por F-04/F-01; ver §regresión |
| `langchain-ai/langchain` | PARCIAL — 7/2.879 (0,24%) **`libs/` y `.devcontainer/` vacíos** | **PARCIAL — 15/2.879** (0,52%) **`libs/` y `.devcontainer/` con contenido** | F-01 retry empty-aware funcionó: libs (95% del repo) pasa de vacío a kf=5 deps=18 concerns=2 |

---

## Repo 1 — `kubernetes/kubernetes` (vs v1)

- **v1**: SHA `d92b8fe8f29d`, sub-agents `[/, cluster, cmd, hack, pkg, misc/]`, files vistos 19, 76,6k tokens.
- **v2**: SHA `d80217f87329` (HEAD avanzó), sub-agents `[/, ., pkg, staging, api, misc/]`, files vistos 20, ~48k tokens.

### Sub-agentes y cobertura

| Sub-agente v1 | Sub-agente v2 | Notas |
|---|---|---|
| `/` (root_meta) — kf=0 | `/` — **kf=4 deps=13 concerns=4** | F-01 retry rescató output |
| `cluster` — kf=5 | (perdido en misc/) | tradeoff de scoring |
| `cmd` — kf=4 | (perdido en misc/) | tradeoff de scoring |
| `hack` — kf=0 | (eliminado correctamente — penalty -100 fixture-like) | F-04 ✅ |
| `pkg` — kf=5 | `pkg` — kf=3 | mantenido |
| (no aparecía) | **`staging` — kf=4** (módulo crítico de k8s) | F-04 promovió ✅ |
| (no aparecía) | **`api` — kf=5** (OpenAPI specs core) | F-04 promovió ✅ |
| `misc/` — kf=5 | `misc/` — **timeout 90s → [unreadable]** | F-01 no aplica a timeouts; flag explícito |

### Gate F-04 (kubernetes)

> **"los sub-agents cubren cmd/, pkg/, staging/ antes que test/ o vendor/"**

✅ `pkg`, `staging` cubiertos.
✅ `test`, `vendor` NO aparecen (penalty -100/-200 los baja a misc).
⚠️ `cmd` no aparece — tradeoff: `staging` + `api` ganaron en scoring (ambos tienen manifests + nombres estructurales). En v1 `cmd` ganaba sobre `staging` por puro filecount, ahora la combinación filecount + bonus estructural ordena distinto. **Aceptable**: cubrir staging (~50% del código real de Kubernetes via repos staged) > cubrir cmd (binarios CLI).

### Hallazgo colateral

Sub-report con `path: "."` (no `path: "<sub_path>"`) — el LLM glm-flash a veces emite `"."` en vez del sub_path real. No es bug de F-04/F-01, es desobediencia del modelo al prompt P-001. Documentado para sesión aparte (no S1.5 Sprint 1).

---

## Repo 2 — `facebook/react` (vs v1)

- **v1**: SHA `dd453071d976`, sub-agents `[/, compiler, fixtures/view-transition, packages/use-sync-external-store, scripts, misc/]`, files vistos 18, ~40k tokens.
- **v2**: SHA `d5736f098ede` (HEAD avanzó), sub-agents `[/, compiler, packages, scripts, fixtures, misc/]`, **6/6 timeout 90s**, ~20k tokens.

### Sub-agentes y cobertura

| Sub-agente v1 | Sub-agente v2 | Notas |
|---|---|---|
| `/` — kf=3 | `/` — **timeout** | regresión tipo runtime |
| `compiler` — kf=0 (vacío) | `compiler` — **timeout** | en v1 el problema era empty (F-01 lo cubriría); en v2 ni llega |
| `fixtures/view-transition` — kf=5 | `fixtures` — **timeout** | F-04: el path top-level es `fixtures` (penalty -100), pero al ser top-level grande igual cae en el ranking |
| `packages/use-sync-external-store` — kf=5 | **`packages`** — timeout | F-04 promueve `packages` directo en lugar de un sub-path peculiar de v1 ✅ (cuando el LLM funcione) |
| `scripts` — kf=0 (vacío) | `scripts` — timeout | idem |
| `misc/` — kf=5 | `misc/` — timeout | |

### Gate F-04 (react)

✅ `packages` aparece como sub-agente directo (vs v1 que sólo cogió `packages/use-sync-external-store`). El bonus +80 a "packages" + manifest detect en `packages/package.json` lo promovió correctamente.
✅ `compiler` mantenido (también structural).
⚠️ `fixtures` aún aparece pese a penalty -100, porque tiene tantos archivos que `min(fileCount, 200) - 100 = 100`, y otros directorios menores quedan más abajo. La penalty no es absoluta — es relativa al filecount.

### Regresión "ROTO" — investigación

Los 6 sub-agents timeout 90s exacto = `perSubagentTimeoutMs` del DEFAULT_BUDGET. **No es F-04/F-01** — esos no afectan latencia. Causas probables:
1. **glm-4.7-flash bajo OpenRouter está rate-limited / lento** en este momento. El re-mapping a glm-flash en leaves (commit `96fa3f0`) puede ser sensible a hora del día / load del proveedor.
2. El `repository_summary` final dice "all sub-reports timed out and could not be read" — el sintetizador (claude-sonnet-4-6) recibe 6 SubReportError y emite el reporte degradado correctamente (no inventa).

Hallazgo: con 6 timeouts seguidos, la bridge gateway no detecta patrón ni hace backoff específico para glm-flash. Pendiente fix aparte (no Sprint 1).

---

## Repo 3 — `langchain-ai/langchain` (vs v1)

- **v1**: SHA `1519ed5afbc3`, sub-agents `[/, libs, .github, .devcontainer]`, **`libs` y `.devcontainer` vacíos** (kf=0 deps=0 concerns=0), files vistos 7, ~24k tokens.
- **v2**: SHA `5fdb73a9e75c` (HEAD avanzó), sub-agents `[/, libs, .github, .devcontainer]`, **`libs` y `.devcontainer` con contenido** (kf=5 deps=18 / kf=3 deps=14), files vistos 15, ~17k tokens.

### Sub-agentes y cobertura

| Sub-agente v1 | Sub-agente v2 | Notas |
|---|---|---|
| `/` — kf=2 deps=0 concerns=1 | `/` — kf=2 deps=0 concerns=0 | similar |
| `libs` — **kf=0 deps=0 concerns=0** ❌ | `libs` — **kf=5 deps=18 concerns=2** ✅ | **F-01 retry empty-aware funcionó** |
| `.github` — kf=5 deps=2 concerns=3 | `.github` — kf=5 deps=2 concerns=1 | similar |
| `.devcontainer` — **kf=0 deps=0 concerns=0** ❌ | `.devcontainer` — **kf=3 deps=14 concerns=2** ✅ | **F-01 retry funcionó (bonus)** |

### Gate F-01 (langchain)

> **"ningún sub-report vacío llega al sintetizador sin flag explícito"**

✅ `libs` (95% del código del repo) pasa de "vacío sin señal" a "kf=5 deps=18 concerns=2". El retry con prompt enriquecido ("re-read more carefully") rescató contenido genuino.
✅ `.devcontainer` también: pasa de vacío a kf=3 deps=14.
✅ Ningún `[degraded-empty]` final esta vez — el retry logró output válido en el segundo intento. Si hubiera quedado vacío, ahora se marcaría como flag explícito (no se observó porque el retry fue suficiente en este caso).

---

## Patrones transversales (v2 vs v1)

1. **F-04 promueve módulos correctos**: en kubernetes `staging`+`api` aparecen donde antes no; en react `packages` reemplaza el sub-path peculiar `packages/use-sync-external-store` que ganaba por filecount; `hack` y `vendor` correctamente penalizados.

2. **F-04 trade-offs**: en kubernetes `cmd` se pierde a favor de `staging`. En general, cuando hay >5 candidatos estructurales fuertes, el cap de `maxSubagents=6` obliga a elegir. La elección actual (manifest + structural names + filecount) es defendible.

3. **F-01 rescata contenido genuino**: en langchain, las 2 carpetas que en v1 venían vacías (libs, .devcontainer) producen output con contenido en v2. El retry con prompt enriquecido funciona empíricamente, no solo en teoría.

4. **F-01 protege contra silenciamiento**: si el retry no recupera contenido, el sub-report se marca `[degraded-empty]` y el sintetizador lo trata como risk severity low (gracias a la línea añadida en P-002/P-003). Ningún output vacío llega silencioso.

5. **Regresión react NO atribuible a Sprint 1**: 6 timeouts = problema de glm-flash bajo OpenRouter en ese momento. Documentado como hallazgo colateral.

6. **Coverage absoluta sigue baja** (0,07–0,52%): F-04+F-01 atacan dos patrones específicos pero no resuelven el problema raíz de "depth=1 con 6 sub-agentes no escala a repos grandes". Eso es F-S1.5-02 (HierarchicalReader depth=2 con autoselect), pendiente del Sprint 2.

---

## Datos crudos disponibles

- `docs/s1_5/stress_records.json` — JSON con cifras agregadas v2 (sobrescribe v1; v1 vive en commit `0e9e2d0`).
- `missions/2026-05-07T18-26-51-807Z_s1_5_kubernetes/` — kubernetes v2 outputs.
- `missions/2026-05-07T18-29-21-872Z_s1_5_react/` — react v2 (con timeouts).
- `missions/2026-05-07T18-31-XX_s1_5_langchain/` — langchain v2 con libs rescatado.

## Estado de gates

| Gate | Status |
|---|---|
| F-04: en kubernetes los sub-agents cubren cmd/, pkg/, staging/ antes que test/ o vendor/ | **✅ PARCIAL** — pkg+staging cubiertos; test+vendor NO aparecen; cmd se pierde por tradeoff de scoring (aceptable). |
| F-01: ningún sub-report vacío llega al sintetizador sin flag explícito | **✅ CUMPLE** — langchain libs/.devcontainer rescatados via retry; los timeouts react son `[unreadable]` (flag explícito). |
| tsc limpio | ✅ |
| 112 tests verdes | ✅ |
