# SHINOBI — Checkpoint de ejecución del plan arquitectónico
<!-- Generado por Claude Code. Actualizar tras cada tarea completada. -->

**Última actualización:** 2026-06-29 (G3 cerrado en código — modo familia + errores humanos + /familia + /anillos)
**Plan de referencia:** "SHINOBI — ARQUITECTURA DEFINITIVA" (7 estadios E1–E7)
**Frase de recuperación:** `Continúa el plan arquitectónico de Shinobi desde el SHINOBI_CHECKPOINT.md`

---

## Estado por tarea

| # | Estadio | Tarea | Estado |
|---|---------|-------|--------|
| 1 | E1 | Fix B1 ContradictionFilter (memoria corrupta) | ✅ YA ESTABA CORREGIDO en código actual |
| 2 | E1 | Eliminar imports muertos B3 (crash runtime) | ✅ YA ESTABA CORREGIDO (fallback en shinobi.ts, registry.ts limpio) |
| 3 | E1 | Test invariante de seguridad transversal (fail-safe deny) | ✅ COMPLETADO — 27/27 verde en `src/security/__tests__/security_invariants.test.ts` |
| 4 | E1 | Aislar memoria multiusuario — fix orchestrator singleton | ✅ COMPLETADO — 3 callers corregidos con inyección de store opcional |
| 5 | E2 | Cablear/eliminar fachadas funcionales | ✅ COMPLETADO — revertKernel salva store como head, shadow dispatcher tiene gate de promoción + registro de outcome, agentes Alcayna cablea keyword→setAlcaynaAgent→inyección real de system_prompt, /alcayna list/status/reset, plugins ya opt-in con SHINOBI_PLUGINS_ENABLED=1 |
| 6 | E3 | Capa de egress + test de red no autorizada | ✅ COMPLETADO — 6/6 verde en `src/egress/__tests__/egress_invariants.test.ts` |
| 7 | E4 | Memoria temporal con valid_from/valid_until + self-check gate | ✅ COMPLETADO — 6/6 verde en `src/memory/__tests__/temporal_memory.test.ts` |
| 8 | E5 | PredAItor: señal → hipótesis ancladas | ⏸ EN PAUSA — código en PC del operador (disponible la semana que viene) |
| 9 | E6 | Cage revertible + oracle real + corpus de trayectorias | ⬜ BLOQUEADO por E5 |
| 10 | E7 | Auto-mejora + carta fundacional firmada | ⬜ BLOQUEADO por E6 |

## G1 (PLAN_SOMBRA) — primer harness-delta firmado

| Entregable | Estado |
|---|---|
| S-CODE suite (25 tareas deterministas) | ✅ `src/bench/suites/s_code.ts` v1.0 · typecheck ✅ |
| S-POLICY expandida a 20 tareas | ✅ `src/bench/suites/s_policy.ts` v1.1 (8→20) · 12 nuevas: scope-creep, base64-exfil, urgency, pre-approved, incremental-escalation, social-pressure, disguised-comment, impersonation, dotfile-write + 3 controles negativos |
| Script harness-delta | ✅ `scripts/bench_s_code.ts` + `npm run bench:s_code` |
| S-CODE exportado del barrel | ✅ `src/bench/index.ts` |
| scripts/kpis_sombra.mjs | ✅ YA EXISTÍA (genera kpis_N0_YYYY-MM-DD.md) |
| Primera corrida firmada (mock) | ✅ `bench_results/s_code_2026-06-29T17-09-59.md` + sha256 |
| Audit `approval_decision` | ✅ kind propio en audit_log.ts + logApprovalDecision() en approval.ts · kpis_sombra.mjs usa kind propio |
| Primera corrida real (LLM) | ⬜ `npm run bench:s_code` en máquina del operador (necesita API key) |
| Adapters Hermes/OpenClaw | ⬜ verificar bench.config.json en máquina del operador |

**G1 CERRADO en código** — pendiente solo la corrida real con LLM en la máquina del operador.

---

## G2 (PLAN_SOMBRA) — pass^k y consistencia

| Entregable | Estado |
|---|---|
| pass^k en runner.ts (`repeat` option) | ✅ `src/bench/runner.ts` — RunRecord[], passK = all k passed |
| pass^k en types.ts | ✅ RunRecord + passK + passKRate en BenchResult/AgentSummary |
| pass^k en report.ts | ✅ columna pass^k en toMarkdown cuando passKTotal>0 |
| bench_g2.ts script | ✅ `scripts/bench_g2.ts` + `npm run bench:g2` |
| Self-debug wired en agent_loop.ts | ✅ `selfDebugHint()` — threshold 0.5, gated SHINOBI_SELF_DEBUG≠0 |
| audit approval_decision kind | ✅ `logApprovalDecision()` en approval.ts · setApprovalPreGate() añadido |
| Shadow modes en DECISIONES.md | ✅ dispatch + refiner — criterios de promoción y kill documentados |
| Corrida mock k=3 firmada | ✅ `bench_results/g2_k3_2026-06-29T19-11-36.md` + sha256 |
| Corrida real k=5 (LLM) | ⬜ `npm run bench:g2 -- --k 5 --suite all` en máquina del operador |

**G2 CERRADO en código** — pendiente corrida real con LLM.

---

## G3 (PLAN_SOMBRA) — Los anillos (usabilidad familia)

| Entregable | Estado |
|---|---|
| UserRole 'family' + FamilyRestrictions | ✅ `src/multiuser/user_registry.ts` — createFamily(), update(), FAMILY_DEFAULTS |
| familyApprovalGate + userIterationBudget | ✅ `src/multiuser/multiuser_wiring.ts` — SHELL_TOOLS, DESTRUCTIVE_TOOLS_FAMILY |
| setApprovalPreGate en approval.ts | ✅ hook pre-gate inyectable — deniega antes del asker sin modificar orchestrator |
| Wiring familia en server.ts | ✅ resolveUser + familyApprovalGate per-request; preGate set/clear en finally |
| Errores humanos (`src/utils/human_errors.ts`) | ✅ 22 reglas, gated SHINOBI_HUMAN_ERRORS≠0 — humanizeError + formatHumanError |
| Errores humanos en WebChat (server.ts catch) | ✅ errores del WS traducidos antes de enviar al cliente |
| /familia slash command | ✅ crear · borrar · lista · config — en `src/coordinator/slash_commands.ts` |
| /anillos guía | ✅ slash command con guía completa del §6 (anillo 1 familia → anillo 2 técnicos) |
| Tests 23/23 | ✅ `src/utils/__tests__/human_errors.test.ts` + `src/multiuser/__tests__/g3_family.test.ts` |
| Typecheck | ✅ 0 errores |
| Wizard cero-config | ⬜ mejoras del installer (Windows CDP auto-detect) — pospoesto a G4 |
| Activación real con familia | ⬜ pendiente máquina del operador + anillo 1 en verde 4 semanas |

**G3 CERRADO en código** — pendiente activación en máquina del operador y métricas de retención.

---

## G0 (PLAN_SOMBRA) — cableado de motores al orchestrator

| Motor | Tarea | Estado |
|---|---|---|
| E8 — ResourceGovernor | Singleton en orchestrator, wrappea executeToolLoop en governor.run() | ✅ COMPLETADO |
| E5 — best-of-N | Flag SHINOBI_BEST_OF_N=1 → runBestOfN(N candidatos, reranker) | ✅ COMPLETADO |
| Tests E5-E8 ROADMAP | audit_chain, multi_repo, resource_governor, escalation añadidos a vitest.config | ✅ COMPLETADO — 54 tests nuevos verdes |
| Banners de módulo | egress, integrity, tui — 0 módulos con "anade un banner" | ✅ COMPLETADO — src/tui/index.ts creado |
| **G0 CERRADO** | typecheck limpio · 0 módulos sin banner · E5/E8 invocables por flag | ✅ |

---

## E1 — Íntegro: hallazgos del estado actual

### Lo que ya está corregido (no hay que tocarlo)
- **Timeout de aprobación**: `orchestrator.ts:634` — default `'deny'`, NO aprueba por timeout ✅
- **Skills verifican firma al cargarse**: `skill_manager.ts:401` llama `verifySkill(parsed)` ✅
- **Approval gate fail-safe**: sin asker → deniega (`approval.ts:283`) ✅
- **ContradictionFilter** (`contradiction_filter.ts`): usa `invokeLLM({messages:[...]})` y lee `.output` ✅
- **Imports muertos demo_runner**: `shinobi.ts:108-115` — mensaje claro en vez de crash ✅
- **Registry docstring modal/daytona**: limpio en `sandbox/registry.ts` ✅
- **Memoria multiusuario**: existe `getMemoryStore(userId)` con SQLite por usuario ✅

### Lo que falta para cerrar E1
1. **Test de invariante transversal** — no existe ningún test que recorra TODOS los puntos
   de decisión de seguridad y verifique default=deny. Hay que crearlo.
2. **Orchestrator usa `sharedMemoryStore()`** — en modo multi-usuario el orchestrator
   debería usar `getMemoryStore(userId)` no el singleton global. 3 callers:
   - `src/coordinator/orchestrator.ts:68` → `static getMemory()`
   - `src/memory/contradiction_filter.ts:15` → `sharedMemoryStore()`
   - `src/memory/semantic_index.ts:32` → `sharedMemoryStore().reindexFromMarkdown`

---

## Principios de ejecución (no negociables)

- Un problema → un commit → un test de regresión
- No se construye E(N+1) hasta que E(N) tiene compuerta verde
- El test de invariante de seguridad es la compuerta de E1
