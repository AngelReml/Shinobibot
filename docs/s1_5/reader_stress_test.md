# S1.5 — Reader stress test (Habilidad A vs repos grandes reales)

Fecha: 2026-05-07
Branch: `feat/s1.5-reader-stress`
Config: `runRead` con `DEFAULT_BUDGET` (`maxSubagents=6, tokensTotal=50_000`), depth=1 (no jerárquico), **una sola corrida por repo**, sin voting, OpenRouter (Haiku leaves + Opus synth, temperature=0).

> **Diagnóstico solamente. NO fixes propuestos en este doc.** El humano firma antes de cualquier intervención.

## Resultado por repo

| Repo | Resultado | Files cubiertos / total | Sub-agents | Tokens (in+out) | Misc/ branch | Dur read |
|---|---|---|---|---|---|---|
| `kubernetes/kubernetes` | **PARCIAL** | 19 / 29.941 (0,06%) | 6 | ~76,6k | ✅ Sí | 41 s |
| `facebook/react` | **PARCIAL** | 18 / 6.879 (0,26%) | 6 | ~39,6k | ✅ Sí | 27 s |
| `langchain-ai/langchain` | **PARCIAL** | 7 / 2.879 (0,24%) | 4 | ~23,7k | ❌ No | 24 s |

Ningún repo dio "ROTO" (los 3 produjeron `report.json` y `subreports.json` válidos), pero **ninguno dio OK** — la cobertura efectiva es <0,3% en los tres casos.

---

## Repo 1 — `kubernetes/kubernetes`

- **Clone**: 264 MB (shallow), 29.941 files, 34 entradas top-level, SHA `d92b8fe8f29d`.
- **Read**: 6 sub-agentes lanzados, 41 s wall-clock, ~76,6k tokens consumidos (input + output estimado chars/4).
- **Mission dir**: `missions/2026-05-07T07-15-21-767Z_s1_5_kubernetes/`
- **Report sintetizado** (extracto): *"Kubernetes source repository containing cluster bootstrap scripts, command-line tooling, internal packages for volume/Windows service management, staging repositories, and vendored dependencies for the k8s.io ecosystem."*

### Cobertura por sub-agente

| Sub-agente (path) | key_files | deps internal | deps external | concerns |
|---|---|---|---|---|
| `/` (root_meta) | **0** | 0 | 0 | 0 |
| `cluster` | 5 | 4 | 0 | 5 |
| `cmd` | 4 | 2 | 2 | 5 |
| `hack` | **0** | 0 | 0 | 0 |
| `pkg` | 5 | 2 | 2 | 4 |
| `misc/` (28 carpetas agrupadas) | 5 | 0 | 9 | 4 |

### Qué se pierde con depth=1

- **28 de 34 carpetas top-level** terminan agrupadas en `misc/`. Quedan **fuera del análisis dedicado**: `staging/` (donde vive ~50% del código real, todo el monorepo de APIs k8s.io), `vendor/`, `test/`, `plugin/`, `api/`, `build/`, `_artifacts/`, etc. El sub-agente `misc/` solo lee 5 files representativos del conjunto entero.
- **2 de 6 sub-agentes devuelven `key_files=[]`** completamente vacíos (`/` y `hack`). Probable causa: tras concatenar el system prompt reescrito en S1.4 + el few-shot + el contenido de los archivos top-level (incluido `OWNERS`, `OWNERS_ALIASES`, `Makefile.generated_files`, `WORKSPACE`...), el cap de tokens por sub-agente (~8.333 = 50k/6) deja al LLM con poco margen y emite arrays vacíos válidos. **El validador acepta `[]` como output válido** — invisible al usuario.
- **`pkg/` se trata como UN solo sub-reporte** aunque contiene cientos de subdirectorios y miles de archivos. Los 5 `key_files` reportados son una muestra estadísticamente irrelevante.
- **`staging/src/k8s.io/...`** (donde vive `core/v1`, `apps/v1`, `apiextensions-apiserver`, etc., el corazón canónico de la API de Kubernetes) **no aparece como entidad separada** — está enterrado dentro de `misc/`.

### Límite identificado

- `maxSubagents=6` con 34 top-level entries → 28 entries comprimidas en `misc/` con 5 files de muestra.
- Ningún descenso recursivo: `pkg/` (interior masivo) se trata igual que `cluster/` (relativamente plano).
- El budget de tokens excede el declarado: 76,6k > 50k tokensTotal del DEFAULT_BUDGET. **`BudgetGuard` no está enforcing realmente** la suma agregada.
- 2 sub-reports emiten `[]` arrays sin señalar el motivo — degradación silenciosa.

---

## Repo 2 — `facebook/react`

- **Clone**: 37 MB, 6.879 files, 36 entradas top-level, SHA `dd453071d976`.
- **Read**: 6 sub-agentes, 27 s, ~39,6k tokens.
- **Mission dir**: `missions/2026-05-07T07-16-39-902Z_s1_5_react/`
- **Report sintetizado**: *"React monorepo containing the core React JavaScript library for building user interfaces, managed via Yarn workspaces. Includes packages, compiler, build scripts, test fixtures, and development tooling configuration."*

### Cobertura por sub-agente

| Sub-agente | key_files | deps internal | deps external | concerns |
|---|---|---|---|---|
| `/` (root_meta) | 3 | 0 | 19 | 4 |
| `compiler` | **0** | 0 | 0 | 0 |
| `fixtures/view-transition` | 5 | 0 | 10 | 5 |
| `packages/use-sync-external-store` | 5 | 2 | 2 | 2 |
| `scripts` | **0** | 0 | 0 | 0 |
| `misc/` (30 carpetas agrupadas) | 5 | 0 | 2 | 3 |

### Qué se pierde con depth=1

- **El módulo principal `packages/`** (donde vive `react`, `react-dom`, `react-reconciler`, `scheduler`, todos los paquetes core de React) **no es un sub-agente top-level**. La regla de partition lo descompone implícitamente en sus hijos directos, pero solo `packages/use-sync-external-store` es elegida como sub-agente. **Decenas de paquetes core de React quedan en `misc/`** o no aparecen.
- **`fixtures/view-transition` se promueve a sub-agente** dedicado — pero las fixtures son demos/tests, no código de producción. La regla de scoring (priorizar por `countFilesRecursive`) hizo que un directorio de fixtures con muchos archivos se priorizara sobre paquetes core del runtime.
- **`compiler/`** (el nuevo compilador de React, módulo crítico de los últimos 2 años) → `key_files=[]`. Sub-agente vacío.
- **`scripts/`** → idem vacío.

### Límite identificado

- La regla de scoring `countFilesRecursive` con cap=200 prioriza directorios "anchos" (fixtures con cientos de archivos generados) sobre directorios "estructuralmente importantes" (compiler con menos archivos pero mucho más relevantes).
- Mismo patrón de degradación silenciosa que kubernetes: 2 de 6 sub-agentes con arrays vacíos sin señalar.
- 30 de 36 top-level entries en `misc/`.
- `packages/` no se trata como entidad descomponible — la regla solo recurre cuando se promueve a sub-agente.

---

## Repo 3 — `langchain-ai/langchain`

- **Clone**: 36 MB, 2.879 files, 16 entradas top-level, SHA `1519ed5afbc3`.
- **Read**: **4 sub-agentes** (no 6), 24 s, ~23,7k tokens.
- **Mission dir**: `missions/2026-05-07T07-17-22-263Z_s1_5_langchain/`
- **Report sintetizado**: *"LangChain monorepo: an agent engineering platform for building LLM-powered applications with interoperable components and third-party integrations."*

### Cobertura por sub-agente

| Sub-agente | key_files | deps internal | deps external | concerns |
|---|---|---|---|---|
| `/` (root_meta) | 2 | 0 | 0 | 1 |
| `libs` | **0** | 0 | 0 | 0 |
| `.github` | 5 | 0 | 2 | 3 |
| `.devcontainer` | **0** | 0 | 0 | 0 |

### Qué se pierde con depth=1

- **`libs/` está completamente vacío como sub-reporte.** Esto es **el peor fallo de los tres repos**: en LangChain, `libs/` contiene **el 95%+ del código** del proyecto (`libs/langchain`, `libs/core`, `libs/community`, `libs/text-splitters`, `libs/cli`, `libs/standard-tests`, etc.). Sin `libs/` analizado, el reader **no entiende qué es LangChain en la práctica**.
- Solo se lanzaron **4 sub-agentes** porque la regla `maxBranches = maxSubagents - 1 = 5` y solo hay 16 top-level entries; con tail < umbral, no se crea `misc/`. Pero esto significa que **no se pone tail-grouping y carpetas pequeñas escapan** al análisis (e.g. `cookbook`, `docs`, `templates` — no aparecen).
- Sub-agente vacío para `.devcontainer` no es preocupante (carpeta de config), pero `libs` vacío sí es crítico.

### Límite identificado

- **El sub-agente leaf de `libs/` recibe ~2.700+ archivos potenciales pero solo lee `filesCap=5`** (porque `tokensPerSub=50k/6=8333`, `filesCap=floor(8333/1500)=5`). Y entre los 5 archivos prioritarios está `pyproject.toml` o similar, que probablemente sea suficiente para que el LLM responda algo — pero aquí devolvió `[]`. Probable: el LLM reconoció que con 5 archivos no puede caracterizar el módulo y emitió arrays vacíos en lugar de inventar.
- Sin descenso recursivo, `libs/langchain/`, `libs/core/`, etc. no se exploran. La granularidad mínima del análisis es el directorio top-level.
- **Ausencia de `misc/` no significa que todo se cubra** — 12 de 16 entradas top-level (las pequeñas) caen fuera de los 4 sub-agentes ejecutados sin agruparse.

---

## Patrones transversales (los tres repos)

1. **Cobertura efectiva absurdamente baja**: 0,06% – 0,26% del repo. Para un sistema de auditoría, leer <1% del código es indistinguible de "no leer nada".

2. **Degradación silenciosa via `[]`**: los sub-agentes con presupuesto insuficiente o entrada poco representativa devuelven `key_files=[]`, `dependencies={internal:[],external:[]}`, `concerns=[]`. **El validador acepta**. **El sintetizador acepta**. El usuario no se entera. (En los 3 repos: 5 sub-agentes vacíos de un total de 16 lanzados — **31% de los sub-reports no aportan información**.)

3. **`misc/` como agujero negro**: en kubernetes y react, `misc/` agrupa 28-30 carpetas heterogéneas en 1 sub-agente con 5 files de muestra. La info se pierde sin recuperación.

4. **Scoring de prioridad sesgado**: `countFilesRecursive` con cap=200 prioriza directorios anchos (fixtures, vendor) sobre directorios estructurales pequeños pero críticos (compiler, internal/, api/). Anti-Pareto.

5. **Sin descenso recursivo**: la unidad atómica del análisis es el directorio top-level. `pkg/` en kubernetes (~10.000 archivos en cientos de submódulos) y `libs/` en langchain (~2.500 archivos en 7 paquetes) se tratan como cajas negras de un solo sub-agente.

6. **`tokensTotal` no se enforce realmente**: kubernetes consumió 76,6k tokens vs el `tokensTotal=50000` declarado. `BudgetGuard` (mencionado en el design doc A.1) no aparece llamado en `runRead/RepoReader.ts`. Es un cap nominal sin mecanismo activo.

7. **Termina OK siempre**: ningún read crashed. La señal de "éxito" del flujo (`result.ok=true`) no captura "lectura útil vs lectura vacía". Producto comercial **no debería** vender outputs así sin disclaimer.

---

## Datos crudos disponibles

- `docs/s1_5/stress_records.json` — JSON con cifras agregadas por repo.
- `missions/2026-05-07T*_s1_5_<repo>/subreports.json` — sub-reports literales por sub-agente.
- `missions/2026-05-07T*_s1_5_<repo>/report.json` — síntesis Opus de cada repo.
- `missions/2026-05-07T*_s1_5_<repo>/meta.json` — metadata por corrida.

## Estado

3 corridas ejecutadas (una por repo, sin voting, depth=1). Diagnóstico documentado. **No se proponen fixes en este doc por instrucción del prompt.txt**. Esperando firma humana para definir alcance de S1.5 (mejoras al lector) o cambio de prioridad.
