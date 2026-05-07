# S1.4 — baseline SUMMARY (parcial 14/15)

Generated: 2026-05-06T20:40:00Z (manual; runner crasheó antes de escribir el SUMMARY automático)
Phase: `baseline`
Modelo: cerebros por tarea vía OpenRouter (Haiku para SubAgent leaves, Opus para synth/committee/improvements/learn/regenerate). temperature=0 (F1).
Voting: 3 (T1, T3).

## Estado: 14/15 capturados, T1.run3 falló por error NO transitorio

| Task | Run | Duración (s) | OK | Output | Tamaño |
|------|-----|--------------|----|--------|--------|
| T2 | 1 | ~62 | ✅ | T2_run1_self.json | 5608 B |
| T3 | 1 | ~57 | ✅ | T3_run1_committee.json | 8986 B |
| T5 | 1 | ~43 | ✅ | T5_run1_proposals.json | 15550 B |
| T4 | 1 | ~45 | ✅ | T4_run1_manual.json | 9148 B |
| T1 | 1 | ~329 | ✅ | T1_run1_audit.md | 7675 B |
| T2 | 2 | ~76 | ✅ | T2_run2_self.json | 4826 B |
| T3 | 2 | ~30 | ✅ | T3_run2_committee.json | 11818 B |
| T5 | 2 | ~38 | ✅ | T5_run2_proposals.json | 12938 B |
| T4 | 2 | ~92 | ✅ | T4_run2_manual.json | 7359 B |
| T1 | 2 | ~110 | ✅ | T1_run2_audit.md | 7177 B |
| T2 | 3 | ~38 | ✅ | T2_run3_self.json | 6278 B |
| T3 | 3 | ~52 | ✅ | T3_run3_committee.json | 4135 B |
| T5 | 3 | ~119 | ✅ | T5_run3_proposals.json | 11695 B |
| T4 | 3 | ~130 | ✅ | T4_run3_manual.json | 8113 B |
| T1 | 3 | — | ❌ | (falta) | — |

**Error literal de T1.run3**:
```
HierarchicalReader failed: final synth invalid twice: risk.description invalid
  at runAudit (src/audit/runAudit.ts:273:15)
```

Diagnóstico: el LLM (Opus en synth final) devolvió un `RepoReport` cuya `risks[].description` excedió 200 chars. El validador `validateRepoReport()` retried 1 vez y falló de nuevo. Mi `withRetry()` clasificó esto como **no-transitorio** (no es 429/timeout/5xx) y lo propagó sin retry adicional, según las reglas firmadas en CHECKPOINT 4 ("Si una corrida individual falla por error transitorio, reintenta hasta 3 veces").

Esto NO es bug del prompt — es bug del **validador de schema**, demasiado estricto para outputs reales del LLM. Es información valiosa para S1.4: un prompt reescrito (P-003) podría ser más explícito sobre el cap de 200 chars en `risks[].description`. Hallazgo colateral candidato.

## Observaciones cualitativas

### T1 — Audit DVWA (run 1 vs run 2)

**Varianza entre runs**: ALTA. Run 1 produjo 27 risks, run 2 produjo un set distinto (verifiable comparando los .md). Verdict consistente: ambos `FAIL/high`. Verdict_confidence: `high` (votos `[high, high, high]` en ambos runs).

**Detección de seguridad** (P-010 code_reviewer): excelente. Run 1 cita literalmente:
- `vulnerabilities/authbypass/change_user_details.php:46 — SQL injection via string concatenation`
- `vulnerabilities/api/src/Token.php:10 — hardcoded encryption key 'Paintbrush'`
- `vulnerabilities/api/src/LoginController.php:78 — hardcoded credentials`
- `vulnerabilities/authbypass/authbypass.js:37-44 — XSS via innerHTML`
- `login.php:41 — password hashed with unsalted MD5`

Cinco signals con archivo:línea. Esto valida que el code_reviewer (P-010) ya funciona en baseline.

**Hallucinations detectadas** (P-001/P-003): una. Run 1 risks #15, #19 mencionan "Turborepo/TypeScript/Next.js stack en dvwa/ y database/". DVWA es PHP puro — eso es un sub-report falso (probablemente confundió un `package.json` template). El sintetizador lo marcó correctamente como contradicción (`MEDIUM`). No es alucinación severa, es eco de una sub-lectura mala.

**Roles del committee**: 3 de 4 emitieron reports válidos. `design_critic` falló en run 1 con `validation failed twice: weaknesses item invalid`. Mismo bug schema-strict que T1.run3. **Recurrente.**

### T2 — Self read

Cobertura módulos plan v1.0: parcial. Runs mencionan `reader`, `committee`, `audit`, `ledger`. **`knowledge` no aparece** en runs 1-3 (limitación de partition top-level con 6 sub-agents — `knowledge/` queda agrupado). Hallazgo conocido del Capítulo 17.

Hallucinations: ninguna detectada en lectura rápida.

Varianza: media. Tamaños de salida varían (5608, 4826, 6278) — ~30% diferencia.

### T3 — Committee standalone

**Diferenciación de roles**: BUENA en run 1. Architect y security_auditor se enfocan en territorio distinto (architect → boundary issues, security_auditor → permissions + DOS + child process leaks). `design_critic` falló en run 1 con error de parsing (`"```json...is not valid JSON"`) — el LLM emitió fence ```json``` que `tryParseJSON` debería tolerar. **Bug del parser**, no del prompt.

Disensos: present (en runs 2 y 3). Run 1 tiene 0 dissents porque `design_critic` no emitió.

### T4 — Learn valibot

**Captura conceptos**: excelente. Run 3 manual: `purpose=Valibot is a modular, type-safe schema library...`, `public_api=32 entries`, `usage_patterns=5`, `gotchas=5`, `examples=1`, `synonyms=[valibot, Valibot, valibot.dev]`.

Hallucinations API: ninguna detectada en lectura rápida.

Varianza: media. Tamaños 9148, 7359, 8113.

**Calidad de install**: degradada. Manual run 3 tiene `install: unknown` cuando el comando real es `npm install valibot`. El scrape de https://valibot.dev no captura el bloque de instalación en las primeras 20 páginas — el manual marca `unknown` en lugar de inventar.

### T5 — Improvements

Volumen: excelente. 5 propuestas por run. Aplicables: variable. Run 3 tiene mezcla `[OK]` y `[BROKEN_DIFF]`, con un BROKEN específico: `eslint-security-rules` con error "No valid patches in input (allow with --allow-empty)". Es un caso edge del retry F3 (find/replace sobre archivo que no existe).

Varianza: alta entre runs (los 3 proponen mejoras de familias distintas).

## Bugs colaterales descubiertos durante baseline

1. **Validator demasiado estricto**: `validateRepoReport` rechaza `risk.description` >200 chars. Cuando el LLM excede el cap, el retry falla y el audit muere. **Afectó T1.run3**. Candidato a fix en S1.4 paso 5 vía reescritura de P-003 (mensaje más explícito sobre el cap), o relax del validator.
2. **`tryParseJSON` no tolera fences `\`\`\`json`**: el design_critic en T3.run1 falló con `"\`\`\`json...is not valid JSON"`. **Recurrente** (también en T1.run1). Bug del parser real (no del prompt). Hallazgo S1.4.

## Decisión que necesito del humano

3 opciones para T1.run3 faltante:

A. **Aceptar 14/15 como baseline final**. Hay datos suficientes para A/B (los runs 1 y 2 cubren T1 con 5 ejecuciones de Reader + Committee voting=3). Documentar el bug para reescritura.
B. **Relax el validator** (subir cap de `risk.description` de 200 a 400 chars) y relanzar SOLO T1.run3. Cambia el contrato externo del schema, requiere análisis.
C. **Reescribir P-003 ahora** para que el cap sea más explícito (mover "max 200" al inicio de la línea de cada risk con un ejemplo) y relanzar T1.run3. Pero eso anticipa el Paso 5 — no es lo limpio para A/B.

Mi recomendación: **A**. Datos suficientes, el bug se fixa en Paso 5 vía reescritura natural.
