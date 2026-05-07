# S1.4 — Paso 7: Tabla A/B + veredicto preliminar

Fecha: 2026-05-07
Branch: `feat/s1.4-prompt-hardening`

Comparación lado a lado de los outputs `baseline/` (prompts originales) vs `after/` (prompts reescritos en Paso 5 + 2 fixes calibratorios `1ff3d20` P-011 y `6158f11` P-008). Veredicto preliminar de Claude Code para cada tarea. **El veredicto final lo firma el humano.**

> Disclaimer: el `after/` se capturó **antes** de aplicar los 2 fixes calibratorios. Las regresiones documentadas en T3 (validation strict del cap 200ch) y T5 (`@@` malformados) se atribuyen al estado pre-fix; en runtime real post-`6158f11`/`1ff3d20` se espera que ambas se atenúen. La firma humana decide si re-capturar after o aceptar el A/B con el caveat anotado.

---

## T1 — Audit DVWA

### Métricas cuantitativas

| Métrica | Baseline | After | Δ |
|---|---|---|---|
| Runs OK | **2/3** (run3 fallo no transitorio) | **3/3** | **+1** |
| Verdict consistente | FAIL/high (run1) | FAIL/high (3/3) | + más datos, igual verdict |
| `risks[]` count | 27 (run1) | 31 / 30 / 37 | densidad ↑ |
| `risk.description` >200 chars | ≥1 (causó crash) | **0/98** | **bug arreglado** |
| Hallucinations de paths (review rápido) | 1 (Turborepo template) | 0 detectadas | igual o mejor |

### Snippet representativo (T1.run1)

**baseline** (primeros 3 risks):
```
1. [HIGH] Entire app is intentionally vulnerable; default credentials (admin/password, db dvwa/p@ssw0rd) and no automated guard against production deployment
2. [HIGH] Variable interpolation in require_once based on user-selected security level in cryptography module risks LFI if validation gaps exist
3. [HIGH] No production deployment safeguards: hardcoded default credentials (admin/password, dvwa/p@ssw0rd) and no environment-based warnings create critical risk if accidentally exposed
```

**after** (primeros 3 risks):
```
1. [HIGH] Entire application is intentionally vulnerable by design; deploying outside isolated training environment exposes host and network
2. [HIGH] Default credentials hardcoded: admin/password for app login (root README) and db_user 'dvwa'/db_password 'p@ssw0rd' in misc/config
3. [HIGH] vulnerabilities/ dynamically includes files based on security-level variables; path-traversal risk if level input is tampered with
```

Observación: baseline duplica el riesgo de credenciales por defecto en #1 y #3. After lo consolida en #2 con cita de `misc/config`. After cita rutas reales (`misc/config`, `vulnerabilities/`) con más densidad.

### Veredicto preliminar Claude: **MEJORA CLARA**

Tres razones:
1. T1.run3 ahora cierra (el cap 200ch en P-002/P-003 + "split into multiple risks" eliminó el bug que tumbó baseline).
2. Verdicts 3/3 consistentes vs 2/3 baseline.
3. Risks consolidados (menos duplicación en run1) con más trazabilidad a paths reales.

---

## T2 — Self read

### Métricas cuantitativas

| Métrica | Baseline (run1) | After (run1) | Δ |
|---|---|---|---|
| `modules[].name` listadas | `[utils, watchers, reader, scripts, missions]` (5) | `[src, scripts, missions]` (3) | -2 |
| `architecture_summary` honesty markers | 0 ("layers:") | **1+** ("inferred from readable sub-reports only") | **mejora honestidad** |
| Hallucinations de paths | ninguna detectada | ninguna detectada | igual |
| Tamaño output (run1/2/3) | 5608 / 4826 / 6278 B | 4913 / 5375 / 4675 B | similar |

### Snippet representativo (T2.run1 architecture_summary)

**baseline**:
```
Shinobi is a TypeScript/Node.js CLI agent targeting Windows, packaged as a standalone executable via pkg. The architecture is local-first with optional cloud integration.

**Core layers:**
- **src/utils**: Foundational utilities including path validation (permissions.ts), command execution (runner.t...
```

**after**:
```
## Overview
Shinobi appears to be a TypeScript-based autonomous agent framework with the following layers (inferred from readable sub-reports only):

- **src/**: Core runtime utilities including a GitHub release watcher (`hermes_watcher.ts`) for NousResearch/hermes-agent, a Windows PowerShell-based...
```

Observación clave: el after **declara explícitamente** "(inferred from readable sub-reports only)" — el reescrito P-002 ("every fact must trace back") indujo al synth a marcar lo que es inferencia. Baseline no lo hace y suena más afirmativo, pero también se permite extrapolar de un sub-report parcial.

### Veredicto preliminar Claude: **NEUTRO** (con nota)

La caída de `modules[].name` listados (5 → 3) **no es regresión de calidad** — es **artefacto de honestidad**. El after es más explícito sobre qué información tiene de los sub-reports vs qué infiere. El humano decide si prefiere el comportamiento más conservador (after) o más afirmativo (baseline). Para uso comercial, la honestidad gana.

---

## T3 — Committee standalone

### Métricas cuantitativas

| Métrica | Baseline | After (pre-fix P-008) | Esperado post-fix |
|---|---|---|---|
| `architect` OK por run | 1/3, 1/3, 1/3 | 0/3, ?, ? | ↑ con cap 400 |
| `security_auditor` OK por run | 1/3 | 1/3 | igual |
| `design_critic` OK por run | 0/3 (parser fence) | 0/3 (cap 200ch) | ↑ con cap 400 |
| `dissents.length` por run | (run1=0 por dc perdido) | 0, 0, 3 | esperado más |
| `overall_risk` | (mixed por dc perdido) | medium / high / high | igual o mejor |

### Snippet representativo (T3.run1 architect.weaknesses[0])

**baseline**:
```
Many declared modules (coordinator, tools, cloud, bridge, db, memory, runtime, skills) are referenced but unverified — architecture may be aspirational vs. implemented
```

**after** (architect en run1 falló, pero en run3 produjo este weakness):
```
Weakness — shared primitive with unassigned timeout-policy ownership; hang risk propagates to all callers
```

Observación: cuando architect funciona en after, las weaknesses son más cortas y enfocadas. El problema es que el cap 200ch (pre-fix) hacía que fallaran las versiones largas. Con cap 400 post-fix, ambos lados deberían producir output válido.

### Snippet — dissent real en T3.run3 after

```json
{
  "topic": "Interpretation of synchronous execSync in src/utils/runner.ts",
  "positions": [
    {"role": "architect", "position": "Weakness — shared primitive with unassigned timeout-policy ownership; hang risk propagates to all callers"},
    {"role": "security_auditor", "position": "Partial strength — synchronous forking likely prevents callback-based code injection, though the missing timeout is still a weakness"}
  ]
}
```

Esto es **exactamente el tipo de disenso productivo** que el comité debe surfacing — architect lo ve como weakness, security_auditor lo ve como mitigación parcial. Baseline no producía dissents así porque design_critic se perdía y los 2 restantes solían coincidir.

### Veredicto preliminar Claude: **MIXTO → MEJORA esperada post-fix**

- Mejora real: 3 dissents productivos en run3 (vs 0 baseline run1).
- Regresión pre-fix: cap 200ch tumbaba architect además de design_critic.
- Post-fix `6158f11`: cap 400 + "coherence over arbitrary brevity" debería dejar pasar weaknesses largas legítimas. El humano decide si re-capturar T3 o aceptar el A/B con la nota.

---

## T4 — Learn valibot

### Métricas cuantitativas

| Métrica | Baseline (run1) | After (run1) | Δ |
|---|---|---|---|
| `public_api[]` count | 32 | 38 / 38 / 39 | **+19% densidad** |
| `install` field | "unknown" | "unknown" (3/3) | igual (limitación scrape) |
| `examples[]` count | 1 | 1 / 1 / 1 | igual |
| Signatures fabricadas | (no verificable rápidamente) | 0 (todas reflejan API real, ver snippet) | mejora honestidad |

### Snippet representativo (T4 first 3 public_api entries)

**baseline**:
```
object :: v.object(entries: Record<string, Schema>) => ObjectSchema
string :: v.string() => StringSchema
number :: v.number() => NumberSchema
```

**after**:
```
object :: v.object(entries)
string :: v.string()
number :: v.number()
```

Observación: baseline incluye tipos detallados (`Record<string, Schema>`, `=> ObjectSchema`) que **podrían estar inventados** (las docs reales de valibot rara vez muestran tipos genéricos así explícitos en el primer ejemplo). After usa la forma simple oficial (`v.object(entries)`) que matchea el ejemplo canónico de valibot.dev.

P-013 reescrito incluye explícitamente: *"public_api entries must have signatures with the exact parameter names from the source. If you only know the function name, set signature to 'unknown' rather than fabricating one."* — esto explica el cambio: after prefiere signatures cortas y verificables sobre signatures elaboradas y fabricadas.

### Veredicto preliminar Claude: **MEJORA MODERADA**

- +19% densidad sin signatures inventadas.
- Mismo límite scrape (`install: unknown`) — limitación externa, no del prompt.

---

## T5 — Improvements

### Métricas cuantitativas

| Métrica | Baseline | After (pre-fix P-011) | Esperado post-fix |
|---|---|---|---|
| `proposals[]` count por run | 5, 5, 5 | 1, 5, 6 | igual o ↑ |
| Aplicables (ok+fuzzy) por run | (mixto, ~3/5) | 0/1, 1/5, 2/6 | ↑ con @@ explícito |
| `BROKEN_DIFF` por run | (mixto) | 1, 4, 4 | ↓ esperado |
| Tipo dominante de error | varios | "corrupt patch" / "No valid patches" | menos esperado post-fix |

### Snippet representativo (T5.run2 first proposal)

**baseline**:
```json
{
  "id": "runner-permission-guard",
  "file": "src/utils/runner.ts",
  "applicability": "ok",
  "motive": "Wire permissions.isDangerousCommand() into runner.ts execSync to close the arbitrary-command-execution gap flagged by all three reviewers."
}
```

**after** (pre-fix P-011):
```json
{
  "id": "add-security-recommendations-doc",
  "file": "docs/security-recommendations.md",
  "applicability": "broken",
  "motive": "Capture the committee's security findings and recommendations in a tracked doc so follow-up patches have a reference and progress can be measured.",
  "diff": "--- /dev/null\n+++ b/docs/security-recommendations.md\n@@\n+# Security..."
}
```

Observación: baseline propone **edit funcional** sobre runner.ts (aplicable). After (pre-fix) propone **doc consolidado** (más conservador) pero con `@@` sin contadores → broken. **Es exactamente el bug que el fix `1ff3d20` ataca** (formato @@ MANDATORY con ejemplos).

### Veredicto preliminar Claude: **EMPEORAMIENTO pre-fix → MEJORA esperada post-fix**

- Pre-fix `1ff3d20`: el LLM perdía la convención `@@ -L,N +L,N @@` en new-file diffs → broken_diff.
- Post-fix `1ff3d20`: bloque "Unified diff format — MANDATORY" con ejemplo `@@ -0,0 +1,<count> @@` para new files debería eliminar el modo de fallo dominante observado.
- El humano decide si re-capturar T5 o aceptar el A/B con la nota. Si la firma exige re-capturar, T5 + T3 son los únicos que necesitarían CP6 v2.

---

## Resumen del veredicto preliminar Claude

| Tarea | Veredicto pre-fixes | Estado post-fixes (`1ff3d20`, `6158f11`) |
|---|---|---|
| T1 audit DVWA | **mejora clara** | sin cambio (no afectado por fixes) |
| T2 self read | **neutro** (honestidad-vs-cobertura) | sin cambio |
| T3 committee standalone | **mixto** (3 dissents reales pero architect/dc rotos por cap 200ch) | mejora esperada (cap 400) |
| T4 learn valibot | **mejora moderada** (+19% sin invenciones) | sin cambio |
| T5 improvements | **empeoramiento** (BROKEN_DIFF dominante por @@ sin contadores) | mejora esperada (formato @@ explícito) |

**Total preliminar**: 2 mejoras claras + 1 neutro + 1 mixto + 1 empeoramiento (con fixes aplicables).

**Fixes aplicados antes del commit final** (no incluyen re-captura):
- `1ff3d20` fix(s1.4) P-011 con convención @@ explícita.
- `6158f11` fix(s1.4) P-008 cap 200ch → 400ch + validador.

**Decisión que el humano firma**:

A. **Aceptar el A/B con caveat de los 2 fixes**. Documentar en el resumen ejecutivo que T3/T5 mejoran predeciblemente con los fixes pero no se re-capturó. Cierra S1.4. Recomendación de Claude.

B. **Re-capturar `after/` v2 con los fixes aplicados**. Tarda otros ~25 min. Cierra S1.4 con datos limpios A/B v2.

C. **Revertir P-011 y P-008** completamente (volver a originales). Pierde mejora T1 (porque P-002/P-003 dependen del cap explícito que es coherente con P-008 cap original — pero esos no se revierten). Suelo no recomendado.

## Datos pendientes

- Lectura humana cualitativa de T1 risks completos (¿la consolidación es real o el after pierde matices?).
- Verificación de paths citados en T1 contra `git ls-tree HEAD` de DVWA pinned (script disponible en F3).
- Lectura humana de T5 propuestas restantes (las que quedan post-fix esperado).
