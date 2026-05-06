# Sesión 2026-05-06 — F1, F2, F3 · Committee hardening

Tras la batería P12-P22 (que dio 8/11 con 3 fallos legítimos: P14 inestabilidad, P20 comité ciego al código, P22 diffs no aplicables), el `prompt.txt` definió tres tareas concretas para sellar esos huecos. Esta sesión cierra las tres y deja Habilidad B con núcleo de producción.

## F1 — Estabilidad de verdict

**Cierra**: P14 (5 audits del mismo SHA daban `[FAIL, FAIL, FAIL, PASS, FAIL]` — no vendible).

**Implementación**:
- `src/gateway/llm.ts`: `LLMConfig.temperature` propagado al body de `openAIChat` / `groqChat` / `ollamaChat`. Backward-compatible: si `temperature` es `undefined`, no se envía y el provider mantiene su default.
- `src/reader/llm_adapter.ts`: `makeLLMClient({ temperature })` admite default por cliente. `runAudit` lo invoca con `temperature: 0` para reader y committee.
- `src/committee/Committee.ts`: nuevo `votingRuns` (default 1, runAudit usa 3). Cuando `votingRuns >= 2`, ejecuta el comité N veces, vota `overall_risk` y devuelve `verdict_confidence` (`high` unánime / `medium` mayoría / `low` plurality) + `voting_runs[]` como metadata. Agrega consensus/dissents/recommendations a través de runs (dedup por topic).
- `src/audit/runAudit.ts`: **read-cache por SHA**. Si `audits/.machine/<sha>_report.json` existe, se reutiliza el report base. El comité con voting sí corre cada vez. Esto hace que re-auditar el mismo commit produzca verdicts idénticos — comportamiento esperado para un sistema de auditoría reproducible.

**Gate F1 verde**: `scripts/f1_gate.ts` ejecuta 5 audits sobre execa@`f3a2e848` →
```
verdicts:    [PASS, PASS, PASS, PASS, PASS]
confidences: [high, high, high, high, high]
```

## F2 — Profundidad de código en comité

**Cierra**: P20 (audit de DVWA no detectaba SQLi/XSS/etc.; los miembros del comité solo veían meta-descripciones del Reader).

**Implementación**:
- `src/committee/code_reviewer.ts` (nuevo): `pickRiskyFiles` clasifica archivos por extensión (`.php`, `.py`, `.js`, `.html`, `.sql`, etc.) + heurísticas de nombre (`auth*`, `login*`, `query*`, `upload*`, `admin*`...). `buildCodeReviewBlob` construye el blob literal con cap de 8k tokens (~32k chars) y 5k chars por archivo. `makeCodeReviewerRole` produce un `CommitteeRole` cuyo system prompt incluye el código y manda buscar SQL injection / XSS / command injection / path traversal / auth bypass / file upload / hardcoded secrets / weak crypto / insecure deserialization, citando `archivo:línea`.
- `src/committee/Committee.ts`: `SYNTH_SYSTEM` ya no asume 3 roles fijos. Nueva regla en el prompt: *"if a code_reviewer role flagged concrete security issues, those raise overall_risk to at least 'high'"*.
- `src/audit/runAudit.ts`: cuando hay `cloneRoot` (siempre en `/audit`), añade el rol code_reviewer a `[...DEFAULT_ROLES, codeRole]`. Logging `(F1: temp=0, voting=3; F2: +code_reviewer)`.

**Gate F2 verde**: `scripts/f2_gate.ts` ejecuta audit sobre `https://github.com/digininja/DVWA` →
```
code_reviewer present:  YES
signals in committee:   [sql injection, xss, csrf, rce]
signals in audit md:    [sql injection, xss, rce]
verdict:                FAIL/high
```

## F3 — Diffs aplicables en /improvements

**Cierra**: P22 (Opus inventaba contexto de archivo, los diffs producidos no aplicaban con `git apply`).

**Implementación**:
- `Proposal.applicability` (`'ok'` | `'fuzzy'` | `'broken'`) + `apply_error`. Render markdown muestra `[OK]` / `[FUZZY]` / `[BROKEN_DIFF]`.
- `checkProposalApplicability`: `git apply --check` strict → fallback `--3way`.
- `regenerateProposalWithContext`: cuando un diff es `broken` y el archivo existe, pide a Opus `{find, replace}` (mucho más robusto que forzar a un LLM a contar líneas en `@@` headers). Reconstruye un diff sintácticamente válido escribiendo el archivo, capturando `git diff` y reverting. Tolera fuzzy-whitespace match si Opus copió el `find` con indentación distinta.
- `resolveByBasename`: si Opus inventa la ruta (`src/hermes_watcher.ts` cuando es `src/watchers/hermes_watcher.ts`), busca por basename con `git ls-files` y substituye automáticamente.
- `runImprovements`: temperature=0; el system prompt pide ≥5 propuestas; cada propuesta pasa el check (con retry de regeneración cuando broken+file_existe); render con etiquetas `[OK]/[FUZZY]/[BROKEN_DIFF]`.
- `applyProposal`: aborta limpio si la propuesta está marcada `[BROKEN_DIFF]`. Aplica con `git apply` strict primero, fallback `--3way`.

**Gate F3 verde**: `scripts/f3_gate.ts` ejecuta `/self → /committee → /improvements → /apply` →
```
proposals: 5 (4 OK + 1 BROKEN_DIFF)
applied: resolve-license-discrepancy (README.md): git apply OK
tsc: 0 NEW errors after apply (preexisting getTier/setTier excluded)
```

## 4 bugs reales descubiertos durante F3

Implementar F3 reveló 4 bugs en infraestructura que **no estaban en el prompt** pero hubieran reventado el sistema en uso real:

1. **`git apply` falla con `does not match index`**. Causa: el diff capturado por `git diff` después de un edit temporal lleva una línea `index <oldhash>..<newhash>`. El nuevo blob nunca se hace commit, por lo que después del revert no existe en `.git/objects`. `git apply --3way` busca ese blob y falla. Fix: `regenerateProposalWithContext` stripea las líneas `^index <hash>..<hash>` del diff capturado. Sin esa línea, `git apply` solo valida contexto contra el working tree, que es lo que queremos.

2. **`git apply --3way` necesita los blobs en `.git/objects`** que se borran al revertir. Causa: el modo `--3way` intenta merge usando el blob original y el modificado; si alguno no existe, falla aunque el contexto coincida. Fix: `applyProposal` ahora prueba **strict primero**, fallback a `--3way` solo si strict falla. Esto cubre dos casos: (a) diffs reconstruidos por nosotros (strict basta) y (b) diffs naturales con offsets pequeños (3way los tolera).

3. **`f3_gate.ts` ejecutaba `git checkout -- .`** que destruyó cambios sin commit en archivos no relacionados con la propuesta — incluido `improvements.ts` mientras lo iteraba (esa fue la sesión donde tuve que re-aplicar todos los cambios de F3 desde cero). Fix: el gate ahora hace backup del archivo target en memoria antes del apply y lo restaura quirúrgicamente. `git checkout` queda fuera del happy-path.

4. **Errores tsc preexistentes** (`getTier`/`setTier` en `scripts/shinobi.ts`) bloqueaban el gate aunque la propuesta tocara solo `README.md`. Fix: el gate captura un baseline tsc **antes** del apply y solo reporta como FAIL los errores que aparecen **nuevos** después. Errores preexistentes ya no contaminan el verdict del gate.

## Estado actual de Habilidad B

**Núcleo cerrado** (lo que el comité hace ahora):
- 4 roles: architect, security_auditor, design_critic, **code_reviewer** (este último con código fuente literal de los archivos de mayor riesgo).
- Voting de 3 con `verdict_confidence` (high/medium/low).
- Temperature=0 + read-cache por SHA → reproducibilidad determinística por SHA fijo.
- `/improvements` con etiquetas de aplicabilidad y retry de regeneración por find/replace.
- `/apply` con fallback strict→3way y abort limpio en `[BROKEN_DIFF]`.
- Test suites: 7 voting + 15 code_reviewer + 4 applicability + 6 improvements + 7 committee = **39 tests verdes** + 77 de Habilidad A/C/D = 116 totales.

**Integración natural pendiente** (no tocado en esta sesión, fuera del scope del prompt):
- `code_reviewer` solo se activa en `runAudit`. `Committee` standalone (vía `/committee` REPL) sigue con 3 roles. **Decisión pendiente**: ¿activarlo siempre que haya un repo en cwd? ¿flag explícito?
- El cache por SHA es por audit. **Decisión pendiente**: cuando el SHA es `HEAD` y el repo se modificó entre runs, ¿debería invalidarse? Actualmente no — el SHA no cambia hasta el próximo commit, así que las modificaciones working-tree se ignoran (pretendiendo determinismo). Razonable pero hay que documentarlo.
- `verdict_confidence: low` se devuelve pero ningún consumidor lo usa para gating adicional. Idea futura: gate D.3 podría exigir `confidence >= medium` para cerrar contrato.

**Gates ya verdes en sesiones previas y aún válidos**: A.1-A.4, B.1-B.3, C.1-C.2, D.1-D.4. Habilidad D entera sigue verde con los cambios de esta sesión (no hubo regresión).

## Commits

```
c69ce80  fix(stability): F1 — temperatura 0 + majority voting + read-cache por SHA
9bc3eaa  feat(committee): F2 — code_reviewer role con codigo fuente directo
4d24a3e  fix(improvements): F3 — fuzzy apply + check preview + diff regeneration
```

Pusheados a `origin/main` (`716c72a..3e23d98`).

## Tests verdes

```
src/reader/__tests__/reader.test.ts            14 passed
src/reader/__tests__/hierarchical.test.ts      16 passed
src/committee/__tests__/committee.test.ts       7 passed
src/committee/__tests__/voting.test.ts          7 passed
src/committee/__tests__/code_reviewer.test.ts  15 passed
src/committee/__tests__/applicability.test.ts   4 passed
src/committee/__tests__/improvements.test.ts    6 passed
src/knowledge/__tests__/router.test.ts         15 passed
src/knowledge/__tests__/router_e2e.test.ts      6 passed
src/ledger/__tests__/ledger.test.ts            13 passed
─────────────────────────────────────────────────────
Total: 103 passed, 0 failed
```

## Lo que NO se hizo (por contrato del prompt)

- No se intentó "deduplicar mejor" los risks del committee — ese era apunte del reporte P12-P22 pero no estaba en F1/F2/F3.
- No se actualizó la integración del `code_reviewer` en el flujo `/committee` standalone REPL — solo runAudit.
- No se introdujeron cambios en otros gates (A, C, D).

Cierre limpio.
