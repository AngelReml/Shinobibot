# S1.5 — Propuestas de fixes para el reader

Fecha: 2026-05-07
Branch: `feat/s1.5-reader-stress`
Base diagnóstica: `docs/s1_5/reader_stress_test.md` (3 repos, cobertura 0,06%–0,26%, 31% sub-reports vacíos).

> **Propuesta. Ningún cambio aplicado todavía.** El humano firma qué fixes aplicar y en qué orden.

## Mapping diagnóstico → fixes

| Patrón del stress test | Fix propuesto | Prioridad |
|---|---|---|
| Cobertura efectiva <0,3% | Combinación F-S1.5-02 + F-S1.5-04 (cambio profundo del reader) | P0 |
| 5/16 sub-reports vacíos sin señal | F-S1.5-01 detect-and-retry sub-report sospechosamente vacío | P0 |
| `misc/` agrupa 28-30 carpetas en 1 muestra | F-S1.5-03 chunking del tail en lugar de bucket único | P1 |
| Scoring por filecount prioriza fixtures sobre core | F-S1.5-04 scoring estructural con whitelist + penalty | P0 |
| Sin descenso recursivo (pkg/, libs/) | F-S1.5-02 runRead usa HierarchicalReader depth=2 con autoselect | P0 |
| `tokensTotal` no enforced en agregado | F-S1.5-05 BudgetGuard real con cap agregado y abort | P1 |
| `result.ok=true` siempre, sin métrica de calidad | F-S1.5-06 coverage_quality en RepoReport.evidence + CLI banner | P1 |
| (extra) re-encuestar al partition cuando un sub-agente vacía | F-S1.5-07 partition adaptativo (P2 opcional) | P2 |

## Fixes detallados

### F-S1.5-01 (P0) — Detect-and-retry de sub-report sospechosamente vacío

**Problema observado**: 5 de 16 sub-agentes lanzados (kubernetes `/`+`hack`, react `compiler`+`scripts`, langchain `libs`+`.devcontainer`) devolvieron `key_files=[]`, `dependencies={internal:[],external:[]}`, `concerns=[]`. El validador acepta — son arrays válidos. El sintetizador acepta. El usuario no se entera.

**Fix**: en `runSubAgent` tras la validación, añadir detección heurística:
```ts
const isSuspiciousEmpty =
  result.key_files.length === 0 &&
  result.dependencies.internal.length === 0 &&
  result.dependencies.external.length === 0 &&
  result.concerns.length === 0 &&
  task.files_to_read.length > 0;
```
Si `isSuspiciousEmpty`:
1. Reintentar UNA vez con prompt enriquecido: "the previous response had all arrays empty for this folder; this is suspicious. Read the file blocks more carefully and emit at least the obvious entries: file names actually shown, the most-imported package".
2. Si el retry vuelve igual, marcar como `purpose: '[suspicious-empty: N files visible but no content extracted]'` (prefijo señalable distinto a `[unreadable]`).
3. El sintetizador (P-002/P-003) ya marca `[unreadable]` como `risk: medium`. Extender la regla a `[suspicious-empty]` con `risk: low`.

**Coste**: ~30 líneas en `SubAgent.ts`. 1 retry extra → +15-20% costo de tokens.
**Impacto**: el output deja de fingir éxito en sub-reports vacíos. Visibilidad inmediata para el usuario.

---

### F-S1.5-02 (P0) — `runRead` usa `HierarchicalReader` con `depth=2` autoselect

**Problema observado**: en kubernetes, `pkg/` (~10k archivos en cientos de submódulos) se trata como UN solo sub-reporte con 5 key_files. En langchain, `libs/` (95% del código) salió vacío. La unidad atómica del reader actual (`RepoReader` flat) es el directorio top-level — eso no escala a repos grandes.

`HierarchicalReader` con `depth=2` ya existe (D.2 del plan v1.0) y se usa en `runAudit`, **pero `/read` y `runRead` siguen usando `RepoReader` flat**.

**Fix**: en `src/reader/cli.ts`, cambiar `runRead` para construir `HierarchicalReader` con autoselect de depth:
```ts
const topLevelCount = listDirSafe(repoAbs).length;
const totalFilesEstimate = countFiles(repoAbs, 50_000);
const depth: 1 | 2 = (topLevelCount > 12 || totalFilesEstimate > 5_000) ? 2 : 1;
```
Trade-off: depth=2 ejecuta 2× más LLM calls (cada sub-supervisor reparticiona y sintetiza). Tiempos esperados (extrapolando del stress test):
- kubernetes: 41s → ~2-3 min, ~150k tokens.
- react: 27s → ~1-2 min, ~80k tokens.
- langchain: 24s → ~50-90 s, ~50k tokens.

**Coste**: ~20 líneas en `cli.ts` + posible ajuste de `DEFAULT_BUDGET` cuando `depth=2` (subir `tokensTotal` proporcionalmente o documentar excedente).
**Impacto**: cobertura efectiva debería subir de 0,06% a algo en el rango 1-3% (todavía pequeño en absoluto, pero **20-50× más material analizado**). `libs/` en langchain se descompondría en `libs/langchain`, `libs/core`, etc.

---

### F-S1.5-04 (P0) — Scoring estructural con whitelist + penalty

**Problema observado**: en react, `fixtures/view-transition` (cientos de archivos generados de demos) se promovió a sub-agente dedicado, mientras que `compiler/` (módulo crítico) salió vacío. La regla actual es `countFilesRecursive` con cap=200 → directorios anchos ganan, sin importar relevancia.

**Fix**: extender el scoring en `partition()` con factores estructurales:
```ts
function scoreDirectory(name: string, fileCount: number): number {
  let s = Math.min(fileCount, 200);  // base actual
  const moduleManifest = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'];
  if (moduleManifest.some(m => fs.existsSync(path.join(dir, m)))) s += 50;
  if (/^(src|lib|libs|core|app|server|cmd|api|internal|packages)$/i.test(name)) s += 80;
  if (/^(fixtures?|tests?|examples?|demos?|sandboxe?s?|playground|benchmarks?)$/i.test(name)) s -= 100;
  if (/^(vendor|third_party|node_modules|dist|build|target|out|coverage)$/i.test(name)) s -= 200;
  return s;
}
```
Mantener la blacklist actual (`READER_IGNORE_PATTERNS`) sin cambios — los penalties son adicionales para directorios que NO están en la blacklist pero son menos prioritarios.

**Coste**: ~30 líneas en `RepoReader.ts:partition()` + tests.
**Impacto**: en react, `packages/` y `compiler/` se priorizan sobre `fixtures/`. En kubernetes, `staging/` y `pkg/` ascienden, vendor cae. En langchain, `libs/` siempre primero.

---

### F-S1.5-03 (P1) — Tail chunking en lugar de `misc/` único

**Problema observado**: `misc/` agrupa 28-30 carpetas en un sub-agente con 5 files de muestra. Información estructural masiva se pierde.

**Fix**: en `partition()`, en vez de generar UN solo `misc/` cuando `tail.length > 0`, generar **N chunks de tail** donde N depende del budget restante. Por ejemplo, si quedan 2 sub-agents disponibles tras root_meta + heavy:
- `tail-1/` con primeras `tail.length/2` carpetas + 5 files concatenados.
- `tail-2/` con segundas `tail.length/2` carpetas.

Y subir el cap de `maxSubagents` por defecto de 6 a 10 — coste lineal pero cobertura mejor proporcionada.

**Coste**: ~40 líneas en `partition()` + tests.
**Impacto**: en kubernetes, en lugar de `misc/[28 carpetas]` quedaría `tail-1/[14 carpetas]` y `tail-2/[14 carpetas]`. Doble la muestra (10 files vs 5) y permite que el sintetizador detecte patrones por chunk.

---

### F-S1.5-05 (P1) — `BudgetGuard` real con cap agregado

**Problema observado**: kubernetes consumió 76.6k tokens vs `tokensTotal=50000` declarado. `BudgetGuard` mencionado en design doc A.1 no aparece llamado en `RepoReader/HierarchicalReader`. Es un cap nominal sin enforcement.

**Fix**: implementar contador de tokens agregado:
```ts
class BudgetTracker {
  private usedIn = 0;
  private usedOut = 0;
  constructor(private capTotal: number) {}
  add(promptChars: number, replyChars: number): boolean {
    this.usedIn += Math.ceil(promptChars / 4);
    this.usedOut += Math.ceil(replyChars / 4);
    return this.usedIn + this.usedOut <= this.capTotal;
  }
  exceeded(): boolean { return this.usedIn + this.usedOut > this.capTotal; }
  totals(): { in: number; out: number } { return { in: this.usedIn, out: this.usedOut }; }
}
```
En `executeLeaves` y `executeWithSubSupervisors` de `HierarchicalReader`, antes de cada `runSubAgent`, comprobar `tracker.exceeded()`. Si excedido: skip los sub-agentes restantes con `purpose: '[budget-exceeded]'` y registrarlo como `risk: medium` en el synth final.

**Coste**: ~50 líneas + integración en wrapper LLM.
**Impacto**: el budget se cumple realmente. Operador ve qué carpetas se saltaron por budget. Predictibilidad de coste para audits comerciales.

---

### F-S1.5-06 (P1) — Métrica `coverage_quality` y banner CLI

**Problema observado**: `result.ok=true` siempre, aunque 31% de sub-reports estén vacíos. Producto comercial no debería vender outputs así sin disclaimer.

**Fix**: extender `RepoReport.evidence` con:
```ts
evidence: {
  subagent_count: number,
  tokens_total: number,
  duration_ms: number,
  subreports_referenced: number,
  // F-S1.5-06:
  empty_subreports: number,        // count de sub-reports con purpose='[suspicious-empty]'
  unreadable_subreports: number,   // count con purpose='[unreadable]'
  budget_exceeded_subreports: number,  // count con purpose='[budget-exceeded]'
  coverage_estimate: 'good' | 'partial' | 'poor',  // good si <10% empty, partial 10-30%, poor >30%
}
```
En `runRead` (CLI), tras emitir el report, banner:
```
[read] coverage: PARTIAL (3 of 6 sub-agents emitted empty reports — output may be superficial)
```

**Coste**: ~20 líneas + ajuste de schema validador (`validateRepoReport`).
**Impacto**: visibilidad operacional. El usuario sabe cuándo tiene un análisis de superficie vs uno profundo.

---

### F-S1.5-07 (P2 opcional) — Partition adaptativo tras detect-vacío

**Problema observado**: cuando `libs/` en langchain se vacía, no hay ningún mecanismo para reintentarlo con otra granularidad.

**Fix**: si tras F-S1.5-01 un sub-agente queda en `[suspicious-empty]` Y la carpeta tiene >50 archivos hijos, lanzar un sub-agente extra que descomponga la carpeta en sus 2-3 hijos más pesados y los lea individualmente. Re-síntesis local.

**Coste**: ~80 líneas + recursión limitada (cap 1 nivel extra).
**Impacto**: rescata el caso "el sub-agente leaf no pudo abarcar todo". Pero F-S1.5-02 (depth=2 autoselect) ya cubre el 90% de estos casos. Solo aplicar si tras F-S1.5-02 sigue habiendo sub-reports vacíos en repos clave.

---

## Plan de aplicación recomendado (orden propuesto)

| Sprint | Fixes | Razón del orden |
|---|---|---|
| 1 | F-S1.5-04 + F-S1.5-01 | Cambios pequeños, alto impacto, sin tocar arquitectura. F-04 mejora qué se elige; F-01 detecta vacíos. Permite re-correr stress test y medir mejora antes de F-02. |
| 2 | F-S1.5-02 | Cambio arquitectónico mayor (`runRead` usa HierarchicalReader). Re-correr stress test. Esperamos cobertura 1-3% y ningún sub-report vacío. |
| 3 | F-S1.5-05 + F-S1.5-06 | Observabilidad y enforcement. Necesarios para producto comercial pero no para experimento. |
| 4 (opcional) | F-S1.5-03 | Solo si tras F-02 sigue habiendo `misc/` problemáticos. |
| 5 (opcional) | F-S1.5-07 | Solo si tras F-02 hay `[suspicious-empty]` recurrentes. |

## Coste agregado

| Sprint | LOC | Tokens runtime extra | Wall-clock por audit | Tests nuevos |
|---|---|---|---|---|
| 1 (F-04+F-01) | ~60 | +15-20% | +5% | 3-4 unit tests |
| 2 (F-02 depth=2) | ~20 | 2-3× | 2-3× | re-validar con stress test |
| 3 (F-05+F-06) | ~70 | <5% | <5% | 4-5 unit tests |
| 4 (F-03) | ~40 | +20-30% (más sub-agents) | +20-30% | 2 tests |
| 5 (F-07) | ~80 | edge cases | <10% | 2 tests |

**Total si se aplican los 7**: ~270 LOC nuevas + 11-13 unit tests + tokens 3-4× del baseline + wall-clock 2-3× del baseline. Para repos pequeños (execa, p-event), el overhead es despreciable porque depth=1 sigue activo (autoselect en F-02).

## Decisión que el humano firma

1. **Aprobar Sprint 1** (F-04 + F-01) → empezamos con menor riesgo y máximo impacto/coste.
2. **Aprobar Sprint 1+2** (añade F-02 depth=2 autoselect) → cambio arquitectónico, requiere re-validación stress test.
3. **Aprobar todo en orden** → cierre completo del problema, ~2-3 días de trabajo.
4. **Otra prioridad/composición** → indica cuál.
5. **Diferir S1.5 mejoras** → dejar el reader como está, mover sesión a otra capa (S1.6, etc.).

Sin firma humana, no aplico ningún fix.
