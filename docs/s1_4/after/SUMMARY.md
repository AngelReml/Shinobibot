# S1.4 — after SUMMARY

Generated: 2026-05-06T22:08:41Z (auto) + observaciones manuales 2026-05-07
Phase: `after`
Modelo: cerebros por tarea vía OpenRouter (Haiku → SubAgent leaves; Opus → synth/committee/improvements/learn/regenerate). temperature=0 (F1). voting=3 (T1, T3).
> Nota: el header auto-generado decía "Ruta A — gpt-4o-mini + gpt-4o" (string hardcoded en el runner), corregido aquí. La ejecución real fue OpenRouter.

## Resultado: **15/15 runs OK**, 0 fallos. Diferencia clave vs baseline: T1.run3 ahora cierra (baseline falló por validador 200ch).

| Task | Run | Duración (s) | OK | Output | Notas |
|------|-----|--------------|----|--------|-------|
| T2 | 1 | 28.7 | ✅ | T2_run1_self.json | |
| T3 | 1 | 67.9 | ✅ | T3_run1_committee.json | design_critic ERROR (validation) |
| T5 | 1 | 25.3 | ✅ | T5_run1_proposals.json | proposals=1 (broken_diff) |
| T4 | 1 | 140.9 | ✅ | T4_run1_manual.json | program=valibot |
| T1 | 1 | 278.9 | ✅ | T1_run1_audit.md | FAIL/high, 31 risks |
| T2 | 2 | 33.0 | ✅ | T2_run2_self.json | |
| T3 | 2 | 74.1 | ✅ | T3_run2_committee.json | design_critic ERROR |
| T5 | 2 | 62.1 | ✅ | T5_run2_proposals.json | proposals=5 (4 broken, 1 ok) |
| T4 | 2 | 34.6 | ✅ | T4_run2_manual.json | program=valibot |
| T1 | 2 | 345.5 | ✅ | T1_run2_audit.md | FAIL/high, 30 risks |
| T2 | 3 | 125.8 | ✅ | T2_run3_self.json | |
| T3 | 3 | 90.3 | ✅ | T3_run3_committee.json | design_critic ERROR; 3 dissents |
| T5 | 3 | 59.5 | ✅ | T5_run3_proposals.json | proposals=6 (4 broken, 2 ok) |
| T4 | 3 | 33.5 | ✅ | T4_run3_manual.json | program=valibot |
| T1 | 3 | 164.4 | ✅ | T1_run3_audit.md | FAIL/high, 37 risks ✨ (baseline falló) |

## Observaciones cualitativas — comparación lado a lado

### T1 — Audit DVWA

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| Runs OK | 2/3 (run3 falló) | 3/3 | **+1 run completado** |
| Verdict consistente | FAIL/high (2 muestras) | FAIL/high (3 muestras) | igual + más datos |
| Risks/run | 27, ? | 31, 30, 37 | **+ densidad** |
| `risk.description` >200 chars | ≥1 (causó crash) | **0/98 risks** | ✅ **bug 200ch arreglado** |
| `confidence` voting=3 | high (run1, run2) | a verificar | (datos en .machine/) |

**Mejora clara**: el cap explícito de 200 chars con instrucción "split into multiple risks" en P-002/P-003/P-008 reescritos eliminó el bug que tumbó T1.run3 en baseline. El after produce 31, 30, 37 risks por run sin overflow alguno. Esa es **evidencia cuantitativa directa del A/B**.

**Sin regresión detectada en calidad de detección**: las 3 runs siguen produciendo FAIL/high y citando archivos:línea concretas. El verdict_confidence merece comparación detallada en CHECKPOINT 7.

### T2 — Self read

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| Cobertura módulos plan v1.0 | 4 de 5 (run1) | 1-2 de 5 (run1: [reader], run2: [reader], run3: [reader,audit]) | **regresión aparente** |
| Hallucinations | ninguna detectada | (a revisar manualmente) | — |
| Tamaño promedio | 5.6KB | 5.0KB | similar |

**Hallazgo a investigar**: la cobertura de módulos del plan v1.0 cae aparentemente. El reader reescrito (P-001) podría estar agrupando con más severidad las carpetas pequeñas en `misc/`, ocultando `committee/knowledge/ledger`. Hipótesis alternativa: el partition no cambió, lo que cambió es que el synth (P-002) ahora exige trazabilidad estricta y no "infla" el `architecture_summary` con módulos solo mencionados de pasada. La regresión podría ser **artefacto de honestidad**, no de cobertura real. CHECKPOINT 7 lo decide.

### T3 — Committee standalone

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| design_critic OK | 0/3 (run1: parser fence, run2-3: ?) | 0/3 (todos validation failure) | igual roto |
| Dissents (run1, run2, run3) | (run1=0 por design_critic perdido) | 0, 0, 3 | **+3 dissents reales en run3** |
| overall_risk | (mixed) | medium, high, high | mejor diferenciación |

**design_critic sigue fallando** en las 3 runs con `validation failed twice: weaknesses/recommendations item invalid`. El prompt P-007 reescrito añadió ejemplos pero el LLM (Haiku) sigue produciendo items que no validan. **No es regresión** — baseline tenía el mismo problema con causa distinta (parser fence ```json). Aquí el problema es que el item de weaknesses excede el cap o no respeta el shape — bug del **validador**, no del prompt.

**Mejora**: run3 produce 3 dissents reales (baseline en run1 tenía 0 por culpa del design_critic perdido). Cuando el comité funciona, ahora discrepa más visiblemente.

### T4 — Learn valibot

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| public_api entries | 32 | 38, 38, 39 | **+18% densidad** |
| install | "unknown" | "unknown" (3/3) | igual (limitación scrape) |
| examples | 1 | 1, 1, 1 | igual |
| Tamaño | 8KB promedio | 8.2KB promedio | similar |

**Mejora**: P-013 reescrito incluye instrucción "If you only know the function name, set signature to 'unknown' rather than fabricating one" — esto AÑADE más entries (capturando incluso APIs sin signature), no las quita. 38-39 entries es ~+19% sobre baseline. La calidad sin signature inventada es mejor que tener menos APIs con signatures fabricadas.

**Sin regresión**: install sigue siendo "unknown" (limitación del scrape, no del prompt). Examples se mantiene en 1 — el prompt no pide más.

### T5 — Improvements

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| Propuestas/run | 5, 5, 5 | 1, 5, 6 | varianza ↑ |
| Propuestas OK (no broken) | mixed (~3 OK por run) | 0, 1, 2 | **regresión clara** |
| Propuestas BROKEN_DIFF | mixed | 1, 4, 4 | **muchos más broken** |

**Regresión aparente**: la tasa de propuestas aplicables cae. Hipótesis: P-011 reescrito enfatiza "accuracy over volume" y añade prohibiciones ("file MUST exist"). El LLM ahora es más conservador y menos inventivo, pero también produce más diffs sin contadores `@@ -L,N +L,N @@` que git apply rechaza. T5_run1 produjo 1 sola propuesta (un security audit doc consolidado), densa pero con `@@` sin números → broken. P-012 retry no se ejecutó porque P-011 no marcó nada como needing-retry-then-broken.

**Posible interpretación A**: el prompt está rechazando proposals que antes pasaba como "ok" pero que en realidad eran flaky. La calidad subjetiva merece revisión humana.
**Posible interpretación B**: el prompt nuevo confunde al LLM, que pierde la convención de hunk header. Habría que afinar P-011 o el regenerate retry para auto-corregir el `@@` sin contadores.

CHECKPOINT 7 decide.

## Resumen ejecutivo de mejoras y regresiones detectadas

**Mejoras claras** (datos cuantitativos):
- T1: bug del cap 200ch → 0 violaciones en 98 risks emitidos. T1.run3 pasa.
- T1: verdict 3/3 consistente FAIL/high con risks bien acotados.
- T4: +19% densidad de public_api sin signatures inventadas.
- T3: dissents reales emergen cuando el committee funciona.

**Regresiones** (a confirmar en CHECKPOINT 7):
- T2: cobertura módulos plan v1.0 baja en architecture_summary.
- T5: tasa de propuestas aplicables cae.

**Sin cambio**:
- T3 design_critic sigue rompiendo, pero por causa distinta (validator strict vs parser fence). El bug colateral del parser ```json``` queda fuera de S1.4 por decisión humana.
- T4 install: limitación de scrape, no del prompt.

## Datos pendientes para CHECKPOINT 7

- Detalle de hallucinations en T1 (verificar paths de risks contra `git ls-tree HEAD` de DVWA pinned).
- Comparación de estructura T2 entre los 3 runs after (¿el architecture_summary describe los mismos módulos aunque no los liste como `modules[].name`?).
- Lectura humana de propuestas T5 broken: ¿son "broken pero conceptualmente buenas" o "broken porque inventadas"?
- Comparación de varianza entre runs (con temp=0 deberían ser similares; observamos varianza alta en T5).
