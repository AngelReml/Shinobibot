# Criba — actualización 2026-05-04 tras TAREA 1

Snapshot de cambios respecto al `Reporte_Criba_Shinobi.docx` original.

## Promociones de estado

| Capacidad | Estado anterior | Estado nuevo | Evidencia |
|---|---|---|---|
| `/v1/benchmark/auto-gen` | VERDE-CLARO (mock E2E) | **VERDE LIMA** | 15/15 tasks generated + validated con prompt v2 (gpt-4o-mini, 35s, $0.005). Cache: `OpenGravity/datasets_v2/auto_bench/cycle_*.json`. Run real PASS=3/3 sobre subset deterministic. |
| `/v1/benchmark/improve` | VERDE (E2E con mock generator) | **VERDE-CLARO** | Mecanismo correcto: dispara LLMCandidateGenerator, propone 3 candidatas, sandbox correctamente las rechaza si fallan. E2E con tráfico real (auto-bench tasks) pendiente — el sandbox sin red impidió validar skill nueva en este turno (decisión D-016 + sandbox v1.0 sin red). |
| Computer Use Windows nativo (B9) | AMARILLO | VERDE-PARCIAL | smoke `screen_smoke.test.ts` PASS — modules importan, registerTool, forbidden zones, KillSwitch. Demo viva = 30s manual del usuario (`docs/architecture/computer_use.md`). |
| n8n bridge | ROJO | VERDE | endpoint `/api/webhook/n8n` restaurado en dashboard server. E2E PASS. |
| Modo agente residente 24/7 | ROJO | VERDE | `shinobi daemon` + Windows service script + heartbeat 5min. E2E boot PASS. |
| OpenBrain spec | ROJO | VERDE | 3 endpoints + SDK Node + reference impl + E2E. |

## Hallazgos arquitectónicos nuevos

1. **D-016 — separación auditor/auditado** (nuevo doc en `docs/decisions/`). El bug encontrado durante TAREA 1: usar el mismo LLM como generador del benchmark Y como agente bajo prueba sesga los resultados. La decisión: provider distinto entre roles, enforce vía header opcional en una iteración futura.

2. **Sandbox sin red para v1.0** (decisión arquitectónica del usuario, doc en `prompt.txt` cycle): tareas que requieran datos externos llegan precargadas via `setup.files[]`. El generator v2 ya enforce esto en su system prompt.

3. **Generator v2 system prompt endurecido**: prohibe placeholders ("Headline 1", "Item 2"), exige expected determinista exactamente comparable con verifyExactString, y permite devolver MENOS tareas antes que ambiguas. Resultado: `web_scraping` se reduce a 0 cuando el LLM no puede inventar dataset coherente — feature, no bug.

## Datos descubiertos (no acción inmediata)

`OpenGravity/datasets/raw/` contiene **450 ejecuciones reales históricas** del periodo 2026-04-21 → 2026-04-29:
- 3 agents (opencode 408, aider 27, openhands 15)
- 3 modelos (glm-4.7-flash, claude-haiku-4.5, gemini-2.5-flash)
- 20 task templates (R1_T1..R6_T5)
- Hash chain ledger 379 entries en `datasets/ledger.jsonl`
- Gold case **R3_T6_BYPASS_SOPHISTICATED**: 21 ejecuciones, **71% fail** (jailbreak avanzado)
- Worst performer: **R4_T1_RESUMEN_TECNICO** 78% fail
- Patrón sistemático observado: ` ```json ... ``` ` markdown wrap cuando prompt prohíbe explícitamente fence — perfecto para C3 generar skill "strip-md-fence".

Estos datos forenses están **intocados** y son el setup ideal para una corrida E2E real del improve loop con tráfico real (no mocks). Pendiente decisión del usuario sobre subset.

## Lista manual reducida (sin cambios respecto a closure anterior)

Sigue siendo 6 acciones, ~1h 40min. Ver `docs/manual_actions/`.

## Coste acumulado de la sesión

```
Generation calls (varios runs):       ≈ 9
Stub-agent solve calls (5 tasks):     ≈ 5
Improve candidate calls (3 cands):    ≈ 3
Total LLM calls:                      ≈ 17
Estimated spend:                      $0.012 (gpt-4o-mini)
Budget cap declarado por usuario:     $1.00
Margen restante:                      $0.988
```

## Próximo paso (TAREA 2)

Auditar si Shinobi puede pedir tareas a ChatGPT desde Comet con sesión abierta. **Solo audita, no construye.** Lo hago después de cerrar TAREA 1.
