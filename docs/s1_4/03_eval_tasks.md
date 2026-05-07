# S1.4 — Paso 3: Tareas de evaluación A/B

Fecha: 2026-05-06
Branch: `feat/s1.4-prompt-hardening`

Definición formal de las 5 tareas que se ejecutarán **antes** de reescribir prompts (CHECKPOINT 4 — baseline) y **después** de reescribirlos (CHECKPOINT 6 — after). Cada tarea cubre uno de los flujos principales del Plan v1.0 + F-suite.

## 0. Modelo y configuración real

**Firmado por humano (revisión 2): A/B mide el sistema REAL, con cerebros por tarea, vía OpenRouter.**

Cada prompt llama al modelo lógico que Shinobi usa en producción para esa tarea concreta. El override de modelo único (`S14_FORCE_MODEL`) que se introdujo en la revisión 1 fue **revertido** porque medía un sistema artificial que no es el que el usuario final ejecuta.

- **Provider**: OpenRouter (`https://openrouter.ai/api/v1/chat/completions`). Requiere `OPENROUTER_API_KEY` en `.env`.
- **Modelos lógicos** (mapeo `OPENROUTER_ALIAS` en `src/reader/llm_adapter.ts`):
  - `claude-haiku-4-5` → `anthropic/claude-haiku-4.5`. Usado por: SubAgent leaves (P-001).
  - `claude-opus-4-7` → `anthropic/claude-opus-4.7`. Usado por: synth Reader (P-002, P-003, P-004), miembros del committee architect / code_reviewer (P-005, P-010), synth committee (P-009), improvements generator (P-011), regenerate find/replace (P-012), learn synth (P-013).
  - Los otros 2 miembros del committee (security_auditor, design_critic en P-006/P-007) usan `claude-haiku-4-5` por configuración del repo en `DEFAULT_ROLES`.
- **Temperature**: `0` (F1 ya activo).
- **Voting**: `votingRuns=3` para Committee (T1, T3).
- **Aplica a**: tanto baseline (CHECKPOINT 4) como after (CHECKPOINT 6). Mismo mapping en ambos lados — el A/B mide el efecto del prompt manteniendo constante la asignación de modelo por tarea.

**Por qué se revirtió el override de modelo único**:

1. El override hacía que TODOS los prompts del Plan v1.0 + F-suite ejecutaran sobre el mismo modelo (`z-ai/glm-4.7-flash`), pero **eso no es cómo Shinobi corre en producción**. En producción, el SubAgent es Haiku (rápido, barato) y el synth es Opus (caro, capaz de resolver contradicciones). Reescribir un prompt asumiendo que lo va a leer Haiku es muy distinto a reescribirlo asumiendo Opus.
2. Una mejora de prompt válida debe demostrarse contra el modelo que la va a ejecutar en producción. Si la reescritura ayuda a glm-4.7-flash pero perjudica a Opus, no sirve. La rúbrica del Paso 2 ya tiene C1 ("rol senior") y C4 ("ejemplos del dominio") — esos criterios funcionan distinto en cerebros distintos.
3. Decisión: A/B mide el sistema real. Cada tarea con su cerebro nominal vía OpenRouter (Iván paga OpenRouter, los modelos están disponibles bajo esa key).

**Decisión histórica** (cronología):
- Revisión 1: Ruta A (OpenAI directo, gpt-4o + gpt-4o-mini) → bloqueada por `insufficient_quota` tras 1/15 runs.
- Revisión 1.5: Ruta B (OpenRouter, modelo único `z-ai/glm-4.7-flash`) → revertida por la razón de arriba.
- **Revisión 2 (vigente)**: OpenRouter con cerebros por tarea (mapping del adapter en producción).

---

## 1. Reglas comunes a todas las tareas

- **Modelo**: el seleccionado en §0 (consistente baseline ↔ after).
- **Temperature**: `0` (ya activo por F1).
- **Voting**: `votingRuns=3` para tareas que usan Committee (T1, T3). Las demás corren single-shot.
- **Read-cache F1**: **se limpia el cache `audits/.machine/` y `missions/` que afecte a la tarea** entre cada uno de los 3 runs, para forzar regeneración fresca y observar varianza real entre runs (no la del cache reutilizado).
- **Captura literal**: se vuelca el output crudo (markdown del audit, JSON del manual, etc.) sin filtrado a `docs/s1_4/baseline/` (CHECKPOINT 4) o `docs/s1_4/after/` (CHECKPOINT 6).
- **3 runs por config**: cada tarea se ejecuta 3 veces independientes en cada fase. Total: **5 tareas × 3 runs × 2 fases = 30 outputs capturados**.

---

## 2. Las 5 tareas

### T1 — Audit (flujo `runAudit`)

**Cubre prompts**: P-001 (leaf), P-003 (synth root depth=2), P-004 (sub-supervisor), P-005..P-009 (committee), P-010 (code_reviewer).

**Comando**:
```bash
# Limpiar cache previo del SHA target
rm -f audits/.machine/<DVWA-sha>_*.{json,txt}
rm -f audits/digininja__DVWA__*.md

npx tsx scripts/shinobi.ts audit https://github.com/digininja/DVWA
```

**Repo elegido**: DVWA (Damn Vulnerable Web Application). Ya validado por gate F2 — sabemos que el code_reviewer puede detectar SQL injection / XSS / CSRF / RCE. PHP, ~70 archivos, vulnerabilidades reales y bien conocidas.

**Output capturado por run** (3 archivos):
- `baseline/T1_run<N>_audit.md` — el markdown rendered.
- `baseline/T1_run<N>_committee.json` — `audits/.machine/<sha>_committee.json` literal.
- `baseline/T1_run<N>_subreports.json` — `audits/.machine/<sha>_subreports.json` literal.

**Criterios de evaluación humana** (cómo decidir si after > baseline):
1. **Detección de seguridad real (P-010)**: ¿el committee menciona explícitamente "SQL injection", "XSS", "CSRF", "RCE", "command injection", "path traversal"? ¿Cita `archivo:línea`? Más citas concretas = mejor.
2. **Hallucination de paths (P-001/P-003)**: ¿alguna `module.path` o `risks[].description` menciona archivos que **no existen** en DVWA? (verifiable con `git ls-tree`). Cero invenciones = mejor.
3. **Verdict coherente (P-009)**: ¿`overall_risk` está justificado por las weaknesses? Para DVWA debe ser `high`. Si es `medium` o `low` → degradación.
4. **Forma del output**: 5 secciones presentes (Purpose, Architecture, Risks, Recommendations, Verdict), JSON machine válido en `.machine/`. Roto = degradación.
5. **Varianza entre runs**: ¿run1, run2, run3 dan el mismo `overall_risk`? Plus si son idénticos en verdict.

---

### T2 — Self read (flujo `/self` — Reader sobre Shinobi mismo)

**Cubre prompts**: P-001 (leaf), P-002 (synth flat depth=1) o P-003/P-004 si `/self` usa HierarchicalReader. **Nota**: `runSelf` actualmente delega a `runRead` (depth=1, no jerárquico) — confirmar antes de baseline.

**Comando**:
```bash
# /self genera un report.json de Shinobi mismo y lo archiva en self_reports/
npx tsx -e "import('./src/reader/self.js').then(m => m.runSelf({}))"
```

**Output capturado por run** (1 archivo):
- `baseline/T2_run<N>_self.json` — el `self_reports/<ts>.json` recién creado.

**Criterios de evaluación humana**:
1. **Cobertura del repo**: ¿el `architecture_summary` menciona los módulos clave del Plan v1.0 (`reader`, `committee`, `knowledge`, `audit`, `ledger`)? Cuántos de los 5 aparecen.
2. **Hallucination de paths**: ¿alguna `module.path` no existe? Verifiable con `ls src/`.
3. **Coherencia entry_points**: ¿los `entry_points` apuntan a archivos reales (`scripts/shinobi.ts`, `package.json`)?
4. **Calidad de risks**: ¿son específicos al repo (mencionan archivos reales) o genéricos ("missing tests")?
5. **Varianza entre runs**: con temperature=0, los 3 runs deberían ser muy similares en estructura. Diferencias grandes = inestabilidad.

---

### T3 — Committee standalone

**Cubre prompts**: P-005 (architect), P-006 (security_auditor), P-007 (design_critic), P-008 (output rules), P-009 (committee synth). **NO** activa P-010 (code_reviewer requiere repo path; standalone no lo tiene).

**Comando**:
```bash
# Usa el último self_report producido por T2 como input.
LATEST=$(ls -t self_reports/*.json | head -1)
npx tsx -e "import('./src/committee/cli.js').then(m => m.runCommittee('$LATEST'))"
```

**Dependencia**: requiere que T2 ya haya corrido al menos una vez (para tener un `self_reports/*.json` reciente). En la práctica: T2 → T3 → T5 ejecutados en cadena.

**Output capturado por run** (1 archivo):
- `baseline/T3_run<N>_committee.json` — el `committee_reports/<ts>.json` recién creado.

**Criterios de evaluación humana**:
1. **Diferenciación de roles (P-005/P-006/P-007)**: ¿architect, security_auditor y design_critic dicen cosas **distintas**? Si los 3 reports son intercambiables, los roles no están actuando — degradación. Si cada uno se enfoca en su scope (architect → módulos/coupling, security_auditor → secrets/exec/fs, design_critic → naming/ergonomics), bien.
2. **Disensos reales (P-009)**: ¿el `synthesis.dissents` tiene al menos 1 disenso explícito? Si los 3 roles coinciden 100%, sospechoso.
3. **Calidad de recommendations**: ¿son accionables (verbo + target concreto) o aspiracionales ("improve quality")?
4. **Hallucination**: ¿alguna weakness/recommendation menciona archivos que no aparecen en el self_report input?
5. **Varianza entre runs**: con voting=3 dentro de cada run y temperature=0, los 3 runs deberían dar el mismo `overall_risk`.

---

### T4 — Learn programa nuevo

**Cubre prompts**: P-013 (learn synth manual). Indirectamente P-001/P-002 si el target es repo, pero como T4 usa una URL de docs, P-013 es el único que actúa.

**Comando**:
```bash
# Limpiar antes de cada run para forzar scrape + síntesis fresh
rm -rf knowledge/valibot
npx tsx -e "import('./src/knowledge/learn.js').then(m => m.runLearn('https://valibot.dev'))"
```

**Programa elegido**: **valibot** (https://valibot.dev). Schema validation library. Docs cortas (<30 páginas), bien estructuradas, no en `knowledge/` actualmente. Tamaño manageable y conceptos claros (parser / schema / pipe / actions).

**Output capturado por run** (1 archivo):
- `baseline/T4_run<N>_manual.json` — `knowledge/valibot/manual.json` recién creado.

**Criterios de evaluación humana**:
1. **Captura de conceptos clave**: ¿el manual menciona schema / parse / pipe / safeParse / actions / validation? Cuántos de los conceptos centrales aparecen.
2. **Hallucination de API**: ¿alguna `public_api[].name` o `signature` no existe en valibot? Verifiable contra docs reales (lectura humana).
3. **Calidad de install**: ¿`install` da el comando exacto (`npm install valibot` o equivalente) o es "unknown" cuando debería conocerse?
4. **Calidad de examples**: ¿el código de los `examples` es ejecutable o tiene errores sintácticos / APIs inventadas?
5. **Varianza entre runs**: con temperature=0, los manuales deberían ser muy similares en cuáles APIs capturan.

---

### T5 — Improvements (flujo `/improvements`)

**Cubre prompts**: P-011 (generador de propuestas), P-012 (retry find/replace cuando hay BROKEN_DIFF). Nota: el LLM se llama dentro del flujo F3 con resolución por basename y check de aplicabilidad.

**Comando**:
```bash
# Requiere un committee_report previo (lo crea T3).
npx tsx -e "import('./src/committee/improvements.js').then(m => m.runImprovements())"
```

**Dependencia**: T3 debe haber corrido (necesita `committee_reports/<ts>.json` reciente).

**Output capturado por run** (1 archivo):
- `baseline/T5_run<N>_proposals.json` — `proposals/<ts>.json` recién creado.

**Criterios de evaluación humana**:
1. **Volumen útil**: ¿se generan ≥3 propuestas con `applicability ∈ {ok, fuzzy}`? El plan F3 pide ≥5 propuestas, ≥3 aplicables.
2. **Hallucination de paths (P-011)**: ¿`p.file` existe en el repo? Si Opus inventó la ruta (e.g. `src/example_script.ts`), la propuesta pasa a `BROKEN_DIFF` por F3. Menos invenciones = mejor.
3. **Calidad del `motive`**: ¿es específico (cita archivo o concepto del committee) o genérico ("improve the code")?
4. **Calidad del `diff`**: ¿el hunk header `@@ -L,N +L,N @@` apunta a líneas reales? Si después del retry de P-012 sigue BROKEN_DIFF, P-011 + P-012 no convergen.
5. **Varianza entre runs**: ¿los 3 runs proponen cambios similares (mismas familias de mejora) o cosas dispares?

---

## 3. Plantilla de tabla de resultados (CHECKPOINT 7)

Esta plantilla se llenará en el Paso 7 una vez tengamos baseline + after. Una tabla por tarea:

```markdown
### T<N> — <título>

| Run | Fase   | Tiempo | Output válido | # invenciones | # campos vacíos/mal | Longitud | Verdict (si aplica) | Notas |
|-----|--------|--------|---------------|---------------|---------------------|----------|---------------------|-------|
| 1   | baseline |       |               |               |                     |          |                     |       |
| 2   | baseline |       |               |               |                     |          |                     |       |
| 3   | baseline |       |               |               |                     |          |                     |       |
| 1   | after    |       |               |               |                     |          |                     |       |
| 2   | after    |       |               |               |                     |          |                     |       |
| 3   | after    |       |               |               |                     |          |                     |       |

**Snippet representativo lado a lado** (no la respuesta entera):

baseline:
> ...

after:
> ...

**Diferencias cuantitativas**:
- ...

**Veredicto preliminar Claude**: <mejora clara | neutra | empeoramiento>
**Justificación**: ...
```

## 4. Estimación de coste y tiempo

Por tarea, suma de baseline + after = 6 ejecuciones. Aproximadamente:
- **T1 (audit DVWA)**: ~60s/run con voting=3 + code_reviewer. **6 × 60s = 6 min**.
- **T2 (self)**: ~25s/run. **6 × 25s = 2.5 min**.
- **T3 (committee voting)**: ~30s/run. **6 × 30s = 3 min**.
- **T4 (learn valibot)**: ~25s/run con scrape + synth. **6 × 25s = 2.5 min**.
- **T5 (improvements)**: ~60s/run con retries. **6 × 60s = 6 min**.

**Total estimado**: ~20 min de wall-clock, en dos bloques (CHECKPOINT 4 y CHECKPOINT 6) separados por la sesión de reescritura.

Coste de tokens depende del modelo elegido en §0. Con Ruta A (gpt-4o + gpt-4o-mini), las pasadas de Plan v1.0 + F-suite ya midieron ~$2-3 por audit DVWA con committee voting=3 + code_reviewer. Total ~$15-25 USD para los 30 runs.

## 5. Decisión pendiente del humano antes de CHECKPOINT 4

1. **§0 — Ruta A o Ruta B**: ¿gpt-4o + gpt-4o-mini (config actual) o glm-4.7-flash (configurar OpenRouter)?
2. **§2 T4 — Programa elegido**: valibot. ¿OK o prefieres otro? (alternativas equivalentes: pino, fastify, vitest, got).
3. **§2 T1 — DVWA**: ¿OK o prefieres un repo más pequeño?

## Gate del paso 3 — VERDE ✅

- 5 tareas definidas, reproducibles, con comandos exactos.
- Criterios de evaluación humana por tarea (4-5 criterios cada una).
- Plantilla de tabla de resultados lista para CHECKPOINT 7.
- 3 decisiones puntuales del humano marcadas en §5.
- Cero código tocado. Cero prompts modificados.
