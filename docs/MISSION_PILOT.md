# MISSION_PILOT — Habilidad D, misión piloto

Estado: **PROPUESTA — pendiente elección humana**.

Plan §6.1 obliga al humano a elegir entre 3 candidatos y firmar el contrato.
Este documento expone los 3 candidatos, la recomendación con motivos, y el
contrato completo de la opción recomendada listo para validar o rechazar.

---

## Los 3 candidatos del plan

### (a) — Auditoría agentic de repo GitHub aleatorio
**Input**: una URL de GitHub.
**Output**: `audit_<repo>.md` con secciones [Purpose, Architecture, Risks, Recommendations, Verdict].
**Cómo se evalúa visualmente en <5 min**: lees el markdown, comparas con README + estructura del repo.
**Reusa**: Habilidad A entera + Habilidad B (committee como auditores).
**Riesgos**: GitHub puede tener rate limits; repos enormes saturan budget.

### (b) — Resumen temático mensual de transcripts de YouTube
**Input**: identifier de canal de YouTube.
**Output**: `youtube_<canal>_<mes>.md` agrupando temas y citas con timestamps.
**Cómo se evalúa visualmente en <5 min**: lees el markdown, contrastas con tu memoria del canal.
**Reusa**: Habilidad A para meta-lectura + Habilidad C para "aprender" el canal una vez.
**Riesgos**: depende de la API de YouTube y artifacts ya descargados; el repo
ya tiene `artifacts/youtube/` y `dist/scripts/youtube/` así que la
infraestructura existe.

### (c) — Brief diario web monitor
**Input**: 5 fuentes web (RSS, blogs Eigen, GitHub releases).
**Output**: `brief_<fecha>.md` consolidando deltas del día, commiteable a zapweave.com.
**Cómo se evalúa visualmente en <5 min**: lees el brief, verificas con visita manual a 1 fuente.
**Reusa**: Habilidad C scraper (URL mode) + KnowledgeRouter para deduplicar tópicos.
**Riesgos**: 5 fuentes externas → 5 puntos de fallo; difícil hacer 3 corridas
consecutivas idénticas (D.3 exige).

---

## Recomendación: **(a) — Auditoría agentic de repo GitHub**

Tres motivos por los que (a) es la opción más fuerte para D.1→D.3:

1. **Reuso máximo de A/B/C ya verdes**: Habilidad A produce el report base,
   Habilidad B (committee) puede actuar como tres auditores con roles
   distintos sin ningún componente nuevo, Habilidad C es opcional para
   programas que el repo importa.
2. **Repetibilidad para D.3**: el plan §6.3 exige *3 ejecuciones consecutivas
   que pasan el contrato sin intervención*. Un repo congelado (commit hash
   fijo) garantiza determinismo razonable. Los blogs/RSS de (c) cambian cada
   minuto y harían imposible D.3.
3. **Posicionamiento alineado con OpenGravity**: el repo ya tiene
   `web/audit/`, `docs/positioning/audit_b2b.md`, categoría `agentic_audit`
   en el catálogo OG. La misión piloto refuerza la línea comercial real,
   no es un demo de juguete (§6.1 lo prohíbe explícito).

Si (b) o (c) son tu elección, este documento se actualiza con su contrato
correspondiente — son perfectamente válidos, solo más frágiles para
verificación binaria de D.3.

---

## Contrato propuesto — `agentic_audit` (opción a)

### Input

```bash
shinobi audit <github_url> [--commit=<sha>] [--budget=<tokens>]
```

- `<github_url>`: URL pública de un repo. Ejemplo: `https://github.com/sindresorhus/execa`.
- `--commit`: opcional, fija un SHA para garantizar reproducibilidad. Default: HEAD del default branch al momento de clonar.
- `--budget`: opcional, override de tokens totales. Default 50_000 (heredado de Habilidad A).

### Comportamiento esperado

1. Clone shallow (depth=1) en directorio temporal.
2. Habilidad A → `RepoReader.read()` produce `report.json` y `subreports.json`.
3. Habilidad B → `Committee.review(report.json)` con roles `architect`, `security_auditor`, `design_critic`. Persistencia en `committee_reports/`.
4. Síntesis final `audit_<owner>_<repo>_<sha>.md` con secciones obligatorias:
   - **Purpose** (≤300 chars, viene de `report.repo_purpose`).
   - **Architecture** (resumen de modules/entry_points, ≤1500 chars).
   - **Risks** combinando `report.risks` + comité, deduplicados, ordenados por severidad.
   - **Recommendations** combinadas (top 6 del comité, deduplicadas).
   - **Verdict** binario: `PASS` si overall_risk del comité ∈ {low, medium}; `FAIL` si `high`.
5. Persistir en `audits/<owner>__<repo>__<sha>.md` + JSON crudo en `audits/.machine/`.
6. Salida exit 0 si el flujo terminó (independiente del verdict). Exit 1 si falla A o B.

### Output exacto

`audits/<owner>__<repo>__<sha>.md` con esta plantilla:

```markdown
# Audit: <owner>/<repo>@<sha-short>

Generated: <ISO timestamp>
Source:    https://github.com/<owner>/<repo>
Commit:    <full sha>
Verdict:   PASS|FAIL  (overall_risk = <low|medium|high>)

## Purpose
<300 chars max>

## Architecture
<1500 chars max>

## Risks
1. [SEVERITY] description
2. ...

## Recommendations
1. action
2. ...

## Auditors
- architect:        risk=<x>
- security_auditor: risk=<x>
- design_critic:    risk=<x>

## Evidence
- repo_report:    audits/.machine/<sha>_report.json
- subreports:     audits/.machine/<sha>_subreports.json
- committee:      audits/.machine/<sha>_committee.json
- duration_ms:    <int>
- subagent_count: <int>
```

### Métrica de éxito (gate D.3)

Una corrida **PASA** el contrato si y solo si:

1. El archivo `audit_*.md` existe en `audits/`.
2. Las **5 secciones** (Purpose, Architecture, Risks, Recommendations, Verdict) están presentes.
3. **Cada Risk** referencia un módulo o archivo que existe en el repo (verificable con `git ls-tree`). 0 hallucinations graves.
4. **Verdict** está en {PASS, FAIL} y es coherente con `overall_risk` (PASS↔{low,medium}, FAIL↔high).
5. Duración total ≤ **5 minutos** wall-clock.
6. JSON crudo persistido en `audits/.machine/`.

Falla si cualquiera de las 6 condiciones falla.

---

## Ejemplos de éxito (output aceptable)

### Ejemplo de éxito 1 — repo pequeño bien estructurado

Input: `shinobi audit https://github.com/sindresorhus/execa`

Output esperado (extracto):
```
# Audit: sindresorhus/execa@a1b2c3d
Verdict: PASS  (overall_risk = low)

## Purpose
Process execution library for Node.js with simpler ergonomics than child_process.

## Architecture
Single-package npm module exposing execa() factory. Library code in lib/,
type defs in types/, tests in test/ and test-d/.

## Risks
1. [LOW] No CI badge in README — actions/workflow files not surfaced in entry_points.
2. [LOW] Heavy reliance on child_process internals (lib/spawn.js).
```

Por qué cuenta como éxito: módulos referenciados existen (`lib/`, `test/`, `test-d/`), risks son verificables, verdict consistente, ≤5min.

### Ejemplo de éxito 2 — repo medio con problemas reales

Input: un fork con tests faltantes y package.json sin scripts.

Output esperado (extracto):
```
Verdict: FAIL  (overall_risk = high)

## Risks
1. [HIGH] No test suite — package.json scripts.test missing or default placeholder.
2. [HIGH] Direct file system writes in src/index.ts:42 without path validation.
3. [MEDIUM] License mismatch — package.json says MIT, README says ISC.

## Recommendations
1. Add jest/tap to devDependencies and define scripts.test.
2. Wrap fs.writeFileSync calls with a validatePath() helper.
3. Reconcile license fields.
```

Por qué éxito: las 3 risks **están en el repo**, severities son justificadas, verdict FAIL coherente.

### Ejemplo de éxito 3 — monorepo con muchos paquetes

Input: un monorepo lerna/turborepo grande.
Output esperado: la sección Architecture menciona la estructura de packages,
los risks identifican packages específicos por nombre. Duración 3-4 min con
budget=80_000.

---

## Ejemplos de fallo (output que se rechaza)

### Ejemplo de fallo 1 — hallucination

Output incluye:
```
## Risks
1. [HIGH] Function `runUnsafeCommand()` in src/exec.ts allows shell injection.
```

Si `runUnsafeCommand` no existe en el repo (`git grep` lo confirma) → FALLO.
Esto repite el fallo encontrado en B.3 con `src/hermes_watcher.ts` (path
inventado por el LLM). El gate exige verificación cruzada de paths.

### Ejemplo de fallo 2 — verdict incoherente

Output:
```
Verdict: PASS  (overall_risk = high)
```

Verdict y overall_risk se contradicen → FALLO automático.

### Ejemplo de fallo 3 — secciones faltantes

Output sin sección "Recommendations" → FALLO automático (las 5 secciones son obligatorias).

### Ejemplo de fallo 4 — timeout

Duración > 5 min wall-clock → FALLO.

### Ejemplo de fallo 5 — comité sin disensos forzados

El comité produce 3 reportes idénticos sin disensos. Esto **no es fallo del
contrato del piloto** (el contrato no exige disensos), pero sí es una señal
de regresión de Habilidad B que ya pasó B.2 con disensos reales. Documentar
y re-validar B.2.

---

## Componentes nuevos a construir en D.2

D.1 solo define el contrato; D.2 construye el código. Bocetos:

- `src/audit/runAudit.ts` — orquesta clone + read + committee + render.
- `src/audit/render.ts` — produce el markdown según plantilla anterior.
- `scripts/shinobi.ts` — sub-comando `audit` (one-shot, no REPL) o slash `/audit <url>`.
- D.2 además exige `depth=2` en RepoReader. Esto ya es necesario para repos
  grandes y NO se merge a main hasta que tests de regresión confirmen que
  `depth=1` (Habilidad A actual) sigue verde. Plan rollback: `depth` opt-in.

---

## Decisión que necesito de ti

1. **Confirmar opción (a)** — apruebas auditoría de repo GitHub.
2. **O proponer (b)/(c)** — actualizo este doc con el contrato correspondiente.
3. **O modificar el contrato** — qué métrica añadir/quitar.

Sin tu firma explícita ("D.1 cerrada con opción a"), no avanzo a D.2.
Plan §10.3 prohíbe construir el enjambre antes de cerrar el contrato.
