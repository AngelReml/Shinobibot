# S1.4 — Paso 1: Inventario de prompts internos

Fecha: 2026-05-06
Branch: `feat/s1.4-prompt-hardening`
Base commit: `e5b40b4`

Inventario exhaustivo de los prompts que Shinobi envía a un LLM dentro de los módulos del Plan v1.0 (Habilidades A→D + F1/F2/F3). Cada prompt tiene un ID `P-XXX` que se mantendrá en los pasos posteriores.

> **Scope intencional**: este inventario cubre solo prompts del plan v1.0 + hardening F-suite. Prompts en `src/coordinator/orchestrator.ts`, `src/utils/vision_client.ts`, `src/tools/screen_observe.ts`, `src/memory/embedding_provider.ts`, `src/db/context_builder.ts`, `src/constants/prompts.ts` quedan fuera por ser infra preexistente del orchestrator/computer-use, no del plan v2.0 S-stack. Si una capa futura los necesita, se inventarían entonces.

## Tabla maestra

| ID    | Archivo                                  | Función / constante                | Rol del prompt                                                                                            | Líneas    | Tamaño aprox. (chars) | Notas                                                                                       |
|-------|------------------------------------------|------------------------------------|-----------------------------------------------------------------------------------------------------------|-----------|-----------------------|---------------------------------------------------------------------------------------------|
| P-001 | `src/reader/SubAgent.ts`                 | `SYSTEM_PROMPT`                    | Sub-agente Habilidad A: lee una carpeta y devuelve `SubReport` JSON.                                      | 25–41     | ~860                  | El leaf de toda lectura jerárquica. Se ejecuta N×K veces por audit (depth=2). Modelo: Haiku.|
| P-002 | `src/reader/RepoReader.ts`               | `SYNTH_SYSTEM`                     | Síntesis raíz Habilidad A clásica (depth=1).                                                              | 177–193   | ~830                  | Solo se usa cuando `RepoReader` corre directo (no via `HierarchicalReader`). Modelo: Opus.  |
| P-003 | `src/reader/HierarchicalReader.ts`       | `SYNTH_SYSTEM_FINAL`               | Síntesis raíz del árbol depth=2 (Habilidad D).                                                            | 62–76     | ~810                  | Versión casi-idéntica a P-002 pero adaptada al hecho de que recibe sub-síntesis de ramas. Modelo: Opus. |
| P-004 | `src/reader/HierarchicalReader.ts`       | `SYNTH_SYSTEM_INTERMEDIATE`        | Sub-supervisor de rama: consolida N leaves en un único `SubReport`.                                       | 78–90     | ~470                  | Solo activo en depth≥2. Modelo: Opus.                                                       |
| P-005 | `src/committee/Committee.ts`             | `DEFAULT_ROLES[0].systemPrompt`    | Miembro del comité: **architect**.                                                                        | 49–55     | ~225                  | Se concatena con `MEMBER_OUTPUT_RULES` (P-008) en cada llamada. Modelo: Opus.               |
| P-006 | `src/committee/Committee.ts`             | `DEFAULT_ROLES[1].systemPrompt`    | Miembro del comité: **security_auditor**.                                                                 | 56–61     | ~210                  | Mismo patrón. Modelo: Haiku. Lee solo el report sintético, no código (gap cubierto por P-010 en `runAudit`). |
| P-007 | `src/committee/Committee.ts`             | `DEFAULT_ROLES[2].systemPrompt`    | Miembro del comité: **design_critic**.                                                                    | 62–67     | ~205                  | Modelo: Haiku.                                                                              |
| P-008 | `src/committee/Committee.ts`             | `MEMBER_OUTPUT_RULES`              | Anexo común a los 3 roles: schema JSON + reglas mínimas anti-invención.                                   | 70–82     | ~440                  | No es un prompt "rol" pero ES system prompt — se appendiza al de cada miembro.              |
| P-009 | `src/committee/Committee.ts`             | `SYNTH_SYSTEM`                     | Síntesis del comité: agrega los N member reports en consensus / dissents / risk.                          | 127–142   | ~720                  | F1 lo invoca 3× (votingRuns). Regla añadida en F2: si code_reviewer flagged → risk≥high.    |
| P-010 | `src/committee/code_reviewer.ts`         | `makeCodeReviewerRole().systemPrompt` | Rol F2: revisor de seguridad con código fuente literal inyectado al prompt (~8k tokens).                | 108–140   | ~970 (+ blob dinámico)| El blob varía 0–32k chars según los archivos riesgo del repo. Solo se activa en `runAudit`. Modelo: Opus. |
| P-011 | `src/committee/improvements.ts`          | `SYSTEM_PROMPT`                    | Generador de propuestas `/improvements`: traduce recomendaciones → diffs.                                 | 26–50     | ~720                  | Pide "≥5 propuestas" (post P-suite). Conocido por inventar paths/contexto — la mitigación operativa es F3, no este prompt. Modelo: Opus. |
| P-012 | `src/committee/improvements.ts`          | `regenerateProposalWithContext` `sys` | F3 retry: cuando un diff es BROKEN_DIFF y el archivo existe, pide `{find, replace}` con el contenido literal del archivo. | 234–244   | ~580                  | Robusto en práctica (ver gate F3). Modelo: Opus.                                            |
| P-013 | `src/knowledge/learn.ts`                 | `SYNTH_SYSTEM`                     | Síntesis del manual `/learn`: crea `manual.json` (purpose / install / public_api / usage_patterns / gotchas / examples / synonyms / source). | 173–191   | ~850                  | Recibe pages scraped o repo-report. Modelo: Opus (con fallback a Haiku en 429 backoff).     |

**Total inventariado: 13 prompts** (mínimo exigido era 6).

## Observaciones cualitativas pre-rúbrica

Sin entrar todavía en el scoring formal del Paso 2, primera lectura:

- **Densidad de "Do NOT invent"**: aparece en P-001, P-002, P-003, P-008, P-013 (5/13). Es la prohibición canónica. P-005/P-006/P-007 no la tienen porque dependen de P-008 que la appendiza.
- **Roles "senior/junior"**: declarado solo en P-005 ("senior software architect"), P-007 ("senior design critic"), P-010 ("senior application security auditor"), P-002/P-003 ("senior architect"). P-006 dice solo "security auditor" sin nivel. P-001 dice "sub-agent" (genérico). P-011/P-012/P-013 no declaran nivel.
- **Few-shot**: ninguno tiene ejemplo concreto. Todos son schema + reglas.
- **Auto-check**: solo P-012 instruye verificación implícita ("`find` must be EXACT, contiguous substring of the file shown below"). Los demás no piden auto-validación.
- **Formato de salida**: JSON estricto en 11 de 13. Excepciones: P-005/P-006/P-007 son solo el "rol" — el formato lo añade P-008 al final.

## Gate del paso 1 — VERDE ✅

- Inventario commiteado bajo `docs/s1_4/01_inventory.md`.
- 13 prompts identificados (≥6 requerido).
- IDs estables `P-001..P-013` para tracking en pasos 2–7.
