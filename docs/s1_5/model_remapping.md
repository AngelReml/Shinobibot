# S1.5 — Re-mapping de modelos por rol

Fecha: 2026-05-07
Branch: `feat/s1.5-reader-stress`
Objetivo: maximizar calidad/coste sustituyendo `claude-opus-4-7` por alternativas más baratas en roles donde la evidencia del A/B (S1.4 CHECKPOINT 6) y stress test (S1.5) demuestran que un modelo medio es suficiente.

> **Propuesta solamente. Cero código tocado. Esperando firma humana antes de aplicar.**

## 1. Mapping actual — auditoría literal

Encontradas **14 invocaciones** a un modelo lógico en el código, en 7 archivos. El adapter (`src/reader/llm_adapter.ts:10-19`) define dos logical names y los enruta a OpenRouter (preferente) o OpenAI (fallback):

```ts
const OPENROUTER_ALIAS = {
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'claude-opus-4-7':  'anthropic/claude-opus-4.7',
};
const OPENAI_FALLBACK = {
  'claude-haiku-4-5': 'gpt-4o-mini',
  'claude-opus-4-7':  'gpt-4o',
};
```

### Roles, modelos asignados, frecuencia de invocación por audit típico

| # | Rol / función | Archivo:línea | Logical name actual | OpenRouter resuelto | Invocaciones por audit (depth=2, voting=3) |
|---|---|---|---|---|---|
| 1 | SubAgent leaf (lee carpeta) | `SubAgent.ts` (default vía Reader) | `claude-haiku-4-5` | `anthropic/claude-haiku-4.5` | ~12-18 (6 leaves × ~2-3 ramas) |
| 2 | RepoReader synth (depth=1) | `RepoReader.ts:233` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 1 (solo si depth=1) |
| 3 | HierarchicalReader synth_final (depth=2) | `HierarchicalReader.ts:160` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 1 |
| 4 | HierarchicalReader sub_supervisor | `HierarchicalReader.ts:160` (compartido) | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 4-5 (uno por rama promovida) |
| 5 | Committee architect | `Committee.ts:52` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 3 (×voting=3) |
| 6 | Committee security_auditor | `Committee.ts:75` | `claude-haiku-4-5` | `anthropic/claude-haiku-4.5` | 3 |
| 7 | Committee design_critic | `Committee.ts:99` | `claude-haiku-4-5` | `anthropic/claude-haiku-4.5` | 3 |
| 8 | Committee synth | `Committee.ts:263` (`synthModel` default) | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 3 (×voting) |
| 9 | code_reviewer (F2) | `code_reviewer.ts:140` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 3 (×voting, solo en runAudit) |
| 10 | improvements generator | `improvements.ts:105` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 1 (solo en /improvements) |
| 11 | regenerate find/replace | `improvements.ts:297` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 0-N (solo si proposals broken) |
| 12 | learn synth (try opus) | `learn.ts:233` | `claude-opus-4-7` | `anthropic/claude-opus-4.7` | 0-1 (solo en /learn) |
| 13 | learn synth (fallback haiku tras 429) | `learn.ts:253` | `claude-haiku-4-5` | `anthropic/claude-haiku-4.5` | 0-1 |

**Resumen del estado actual**:
- **11 invocaciones (de 13 distintas) usan Opus**.
- **3 invocaciones usan Haiku** (security_auditor, design_critic, learn fallback).
- 0 modelos alternativos. El sistema solo conoce 2 cerebros.

### Nota sobre `S14_FORCE_MODEL` (revertido)

El override `S14_FORCE_MODEL` se introdujo en S1.4 Ruta B y se revirtió en commit `85fb7bb` por la decisión "A/B mide sistema real con cerebros por tarea". Hoy NO está en código. La propuesta de S1.5 NO restaura el override; modifica el mapping "real".

## 2. Modelos OpenRouter relevantes — matriz de precios

Precios indicativos en USD por millón de tokens (verificar en https://openrouter.ai/models antes de aplicar — los valores cambian).

| Modelo | Input $/M | Output $/M | Contexto | Tipo | Notas |
|---|---|---|---|---|---|
| `anthropic/claude-opus-4.7` | **~$15** | **~$75** | 200k | top | actual default synth/committee/code_reviewer |
| `anthropic/claude-sonnet-4.6` | ~$3 | ~$15 | 200k | mid-high | razonamiento sólido a 1/5 del coste de Opus |
| `anthropic/claude-haiku-4.5` | **~$1** | **~$5** | 200k | mid-low | actual default sub-agents |
| `z-ai/glm-4.7-flash` | **~$0.10** | **~$0.30** | 128k | low (reasoning model) | validado en S1.4 Ruta B antes de revertir; produjo outputs razonables |
| `z-ai/glm-4.7` (full) | ~$0.50 | ~$1.50 | 128k | mid | hermano mayor del flash, no probado |
| `google/gemini-2.5-flash` | ~$0.30 | ~$2.50 | 1M | mid-low | contexto enorme, output cara |
| `google/gemini-2.5-pro` | ~$1.25 | ~$10 | 2M | mid-high | alternativa a sonnet |
| `deepseek/deepseek-chat-v3.1` | ~$0.27 | ~$1.10 | 128k | mid-low | barato sin reasoning |
| `deepseek/deepseek-r1` | ~$0.55 | ~$2.19 | 64k | mid (reasoning) | razonamiento más barato que Opus |
| `qwen/qwen-3-72b` | ~$0.40 | ~$1.20 | 128k | mid-low | alternativa china similar a glm |
| `openai/gpt-4o` | ~$2.5 | ~$10 | 128k | mid-high | fallback actual |
| `openai/gpt-4o-mini` | ~$0.15 | ~$0.60 | 128k | low | fallback actual sub-agents |

## 3. Evidencia del A/B (S1.4 CP6) que justifica reasignación

**De `docs/s1_5/reader_stress_test.md` y `docs/s1_4/05_ab_comparison.md`**:

- **Sub-agent leaf con Haiku**: 31% de sub-reports devuelven `[]` arrays vacíos (degradación silenciosa). Cambiar a glm-flash no empeoraría — el problema NO es el modelo, es la entrada (filesCap=5). Coste de Haiku no compra calidad observable.
- **Synth (Opus)** en stress test: report sintetizado en kubernetes/react/langchain es preciso ("inferred from readable sub-reports only" — la honestidad la pone el prompt P-002 reescrito, no Opus). Un modelo medio (Sonnet/glm-full) podría hacer la misma síntesis a 1/5–1/30 del coste.
- **code_reviewer (Opus, P-010)**: F2 con DVWA detectó SQLi, XSS, CSRF, RCE con cita `archivo:línea`. **Esta es la evidencia más fuerte de que Opus aporta valor**. Bajar este rol a un modelo más barato sin re-validación arriesga regresión en seguridad.
- **Committee architect (Opus, P-005)**: el A/B mostró diferenciación de roles cuando el comité funciona (T3.run3 with 3 dissents reales). Sonnet podría mantener esa capacidad a 1/5 del coste.
- **Committee synth (Opus, P-009)**: detectar consensus/dissents sin promediar. Tarea de razonamiento medio. Sonnet o glm-full cubrirían.
- **improvements generator (Opus, P-011)**: tras fix `1ff3d20` (formato `@@` MANDATORY), la calidad depende de seguir reglas estructuradas, no de razonamiento creativo. Sonnet podría sostener; glm-flash arriesga regresión en aplicabilidad.

## 4. Propuesta — 3 tiers + 1 anchor

### Tier "fast" — `z-ai/glm-4.7-flash` (~$0.10 in / ~$0.30 out)
Tareas donde la rúbrica del prompt (S1.4 reescritos) hace casi todo el trabajo y el modelo solo ejecuta forma:
- SubAgent leaf
- Committee security_auditor
- Committee design_critic
- regenerate find/replace
- learn synth (down de Opus, fallback ya iba a Haiku)

### Tier "balanced" — `anthropic/claude-sonnet-4.6` (~$3 in / ~$15 out)
Tareas con razonamiento moderado (síntesis, detección de contradicciones, diffs estructurados):
- RepoReader synth (fallback depth=1)
- HierarchicalReader synth_final
- HierarchicalReader sub_supervisor
- Committee architect
- Committee synth
- improvements generator

### Tier "deep" — `anthropic/claude-opus-4.7` (~$15 in / ~$75 out)
Solo donde la evidencia muestra valor diferencial:
- **code_reviewer** (P-010) — único anchor. Detecta vulns reales con cita `archivo:línea`. Re-validar con un modelo más barato requiere re-correr T1 stress test post-cambio; mantener Opus es más seguro mientras tanto.

### Tabla por rol — actual vs propuesto

| # | Rol | Modelo actual | $/M aprox actual (in/out) | Modelo propuesto | $/M aprox propuesto | Justificación |
|---|---|---|---|---|---|---|
| 1 | SubAgent leaf | claude-haiku-4-5 | $1 / $5 | **z-ai/glm-4.7-flash** | $0.10 / $0.30 | 10× más barato. Tarea de extracción JSON estructurada con auto-check del prompt. |
| 2 | RepoReader synth | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | 5× más barato. Síntesis de N sub-reports con detección de contradicciones — nivel medio. |
| 3 | HierarchicalReader synth_final | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Idem. |
| 4 | HierarchicalReader sub_supervisor | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Síntesis local más simple que la raíz. Sonnet sobra. |
| 5 | Committee architect | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Crítica arquitectónica con citas a módulos. Razonamiento medio. |
| 6 | Committee security_auditor | claude-haiku-4-5 | $1 / $5 | **z-ai/glm-4.7-flash** | $0.10 / $0.30 | La detección real viene de code_reviewer (P-010). Este rol opera sobre meta. |
| 7 | Committee design_critic | claude-haiku-4-5 | $1 / $5 | **z-ai/glm-4.7-flash** | $0.10 / $0.30 | Crítica de diseño/UX. No requiere razonamiento profundo. |
| 8 | Committee synth | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Detectar consensus/dissents sin promediar. Razonamiento medio. |
| 9 | **code_reviewer (P-010)** | claude-opus-4-7 | $15 / $75 | **claude-opus-4-7 (sin cambio)** | $15 / $75 | Anchor. Validado por F2 con DVWA detectando SQLi/XSS/RCE con cita archivo:línea. |
| 10 | improvements generator | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Genera diffs estructurados. Calidad depende de reglas (post-fix `1ff3d20`), no de razonamiento creativo. |
| 11 | regenerate find/replace | claude-opus-4-7 | $15 / $75 | **z-ai/glm-4.7-flash** | $0.10 / $0.30 | Substring exacto. Tarea sintáctica simple con auto-check (ctrl-F mental). |
| 12 | learn synth (try) | claude-opus-4-7 | $15 / $75 | **claude-sonnet-4.6** | $3 / $15 | Síntesis de manual estructurada. |
| 13 | learn synth (fallback) | claude-haiku-4-5 | $1 / $5 | **z-ai/glm-4.7-flash** | $0.10 / $0.30 | Fallback en 429 — más barato es mejor. |

## 5. Estimación de coste por flujo típico

Asumiendo audit completo de DVWA (depth=2, voting=3):

### Tokens medidos en CP6 baseline/after y stress test

- Audit DVWA con depth=2 + voting=3 + code_reviewer: ~150k tokens input + 30k output (input/output ratio ~5:1).
- Distribución aproximada por rol:

| Rol | Tokens in | Tokens out |
|---|---|---|
| SubAgent leaf (×12) | ~80k | ~12k |
| sub_supervisor (×4) | ~10k | ~3k |
| synth_final | ~8k | ~2k |
| committee architect (×3) | ~15k | ~3k |
| committee security_auditor (×3) | ~15k | ~3k |
| committee design_critic (×3) | ~15k | ~3k |
| committee synth (×3) | ~9k | ~3k |
| code_reviewer (×3) | ~24k | ~3k |
| **Total** | **~176k** | **~32k** |

### Coste actual (todo Opus + Haiku según mapping vigente)

| Rol | Input $/M | Output $/M | Coste in (USD) | Coste out (USD) |
|---|---|---|---|---|
| SubAgent leaf (Haiku) | $1 | $5 | $0.080 | $0.060 |
| sub_supervisor (Opus) | $15 | $75 | $0.150 | $0.225 |
| synth_final (Opus) | $15 | $75 | $0.120 | $0.150 |
| architect (Opus) | $15 | $75 | $0.225 | $0.225 |
| security_auditor (Haiku) | $1 | $5 | $0.015 | $0.015 |
| design_critic (Haiku) | $1 | $5 | $0.015 | $0.015 |
| committee synth (Opus) | $15 | $75 | $0.135 | $0.225 |
| code_reviewer (Opus) | $15 | $75 | $0.360 | $0.225 |
| **Total/audit** | | | **~$1.10** | **~$1.14** |

**Coste actual estimado: ~$2.24 USD por audit DVWA completo.**

### Coste propuesto (mapping nuevo)

| Rol | Modelo propuesto | Input $/M | Output $/M | Coste in | Coste out |
|---|---|---|---|---|---|
| SubAgent leaf | glm-flash | $0.10 | $0.30 | $0.008 | $0.004 |
| sub_supervisor | sonnet-4.6 | $3 | $15 | $0.030 | $0.045 |
| synth_final | sonnet-4.6 | $3 | $15 | $0.024 | $0.030 |
| architect | sonnet-4.6 | $3 | $15 | $0.045 | $0.045 |
| security_auditor | glm-flash | $0.10 | $0.30 | $0.002 | $0.001 |
| design_critic | glm-flash | $0.10 | $0.30 | $0.002 | $0.001 |
| committee synth | sonnet-4.6 | $3 | $15 | $0.027 | $0.045 |
| **code_reviewer (anchor Opus)** | opus-4.7 | $15 | $75 | $0.360 | $0.225 |
| **Total/audit** | | | | **~$0.50** | **~$0.40** |

**Coste propuesto estimado: ~$0.90 USD por audit DVWA completo.**

**Ahorro: ~60% por audit** (~$1.34 menos), manteniendo el anchor que probadamente importa.

### Sensibilidad del ahorro

- Si **eliminamos también code_reviewer Opus → sonnet** (no recomendado sin re-validar): ~$0.32/audit (-86%). Pero arriesga regresión en detección de seguridad.
- Si **bajamos sonnet → glm-full** (sin probar): ~$0.30/audit (-87%). Arriesga regresión en synth/committee/improvements.
- Si **dejamos solo code_reviewer Opus + el resto glm-full**: ~$0.50/audit (-78%). Punto medio agresivo a re-validar.

## 6. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Sonnet más débil que Opus en detección de contradicciones (Reader synth, Committee synth) | Re-correr A/B (5 tareas × 3 runs) post-cambio. Si T2/T3 degradan vs CP6 after, reverter. |
| glm-flash devuelve `[]` arrays más frecuentemente en SubAgent leaf | Ya pasa con Haiku (31% de sub-reports vacíos en stress S1.5). Combinar con F-S1.5-01 (detect-and-retry sospechosamente vacío). |
| Sonnet menos preciso que Opus en formato `@@` de improvements | Tras fix `1ff3d20` el prompt es muy explícito. Si regresa, el retry de F3 (regenerateProposalWithContext con find/replace) ya está en glm-flash y es robusto. |
| Precios cambian en OpenRouter | Documentar la fecha de la propuesta y verificar en https://openrouter.ai/models antes de aplicar. La estructura del cambio (3 tiers) sobrevive aunque los modelos concretos roten. |
| Latencia: glm-flash a veces más lento que Haiku por reasoning_tokens | Aceptable — el cuello de botella no es ese rol. Aceptado como trade-off. |

## 7. Plan de aplicación sugerido (si firma humana)

### Sprint 1 (cambio de mapping)
1. Editar `src/reader/llm_adapter.ts` ampliando `OPENROUTER_ALIAS` con 3 logical names en lugar de 2:
   ```ts
   const OPENROUTER_ALIAS = {
     'tier-fast':    'z-ai/glm-4.7-flash',
     'tier-balanced':'anthropic/claude-sonnet-4.6',
     'tier-deep':    'anthropic/claude-opus-4.7',
     // back-compat para test stubs:
     'claude-haiku-4-5': 'z-ai/glm-4.7-flash',
     'claude-opus-4-7':  'anthropic/claude-sonnet-4.6',  // default downgrade
   };
   ```
2. Cambiar 1 línea en `code_reviewer.ts:140`: `model: 'tier-deep'` (anchor explícito).
3. Cambiar 11 líneas en los demás archivos con su tier correspondiente.
4. Tests de regresión: 112/112 deben seguir verdes (los stubs son agnósticos al modelo).
5. Re-correr A/B con `s1_4_runner.ts after` (tarda ~25 min) para validar no-regresión vs CP6 after.

### Sprint 2 (sólo si Sprint 1 verde)
- Considerar bajar Sonnet → glm-full en synth/committee — solo tras re-validación.
- Considerar bajar code_reviewer → sonnet — solo tras re-validación específica con DVWA.

## 8. Decisión que el humano firma

1. **Aprobar la propuesta tal cual** → Sprint 1 con re-validación A/B obligatoria.
2. **Aprobar con anchor Opus extra** (mantener Opus también en synth_final + committee synth) → ahorro menor pero menor riesgo. Coste estimado ~$1.40/audit (-37%).
3. **Aprobar agresivo** (sin anchor; bajar también code_reviewer a sonnet) → ahorro ~85%. Riesgo regresión seguridad.
4. **Pedir re-revisión** con datos adicionales — ejemplo: re-correr code_reviewer DVWA con sonnet antes de decidir.
5. **Diferir el remapping** y volver a la sesión S1.5 reader fixes.

Sin firma, NO se toca código. Cero cambios aplicados.
