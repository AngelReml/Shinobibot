# D-016 — Separación auditor / auditado

Fecha: 2026-05-04
Status: aceptada
Origen: revelado durante el ciclo `/v1/benchmark/auto-gen` con LLM real (TAREA 1).

## Contexto

Cuando una misma instancia de LLM (gpt-4o-mini en este caso) se usa para a) **generar** las tareas del benchmark *y* b) **resolver** esas tareas como agente bajo prueba, el resultado del benchmark mide la consistencia interna del modelo, no su capacidad real.

Esto se manifestó así durante el run:
- El LLM-generador inventó tareas tipo "scrape weather data" con expected `"temperature and condition data"` o `["Headline 1", "Headline 2"]`.
- El LLM-stub-agente, al ver "scrape", contestó "I'm sorry, but I can't perform web scraping" — coherente con su propio entrenamiento sobre limitaciones.
- 0 skills validadas en sandbox no porque el sistema fallara, sino porque la pareja generador↔solver compartía sesgo.

## Decisión

**Auditor (quien genera el benchmark) y auditado (quien lo resuelve) deben ser instancias técnicamente independientes.** Esto incluye:

1. **Modelo distinto** — preferentemente provider distinto. Si el auditor es OpenAI, el auditado idealmente es Anthropic, Gemini o un modelo open-source via OpenRouter.
2. **System prompt distinto** — el auditor sigue las reglas del generator (`src/benchmark/auto_gen/generator.ts:SYSTEM_PROMPT`), el auditado no las ve.
3. **Sin estado compartido** — ningún cache de embeddings, ningún tool registry compartido entre los dos roles durante una corrida.
4. **Logs separados** — el ledger del benchmark guarda agent_id y model_id distintos para auditor y auditado.

## Consecuencias

- En `/v1/benchmark/auto-gen`: el modelo del generador (`AUTO_BENCH_MODEL`) **no debe** ser el mismo que el del agente bajo prueba.
- En el script `auto_bench_full_cycle.mjs`: si el agente stub usa `gpt-4o-mini`, el generador debe usar otro (`claude-haiku-4.5`, `gemini-2.5-flash`, o cualquier OpenRouter model id distinto).
- La cláusula se enforce automáticamente por el endpoint que ejecuta `/run`: si recibe `agent_url` apuntando al mismo modelo que generó las tareas, devuelve `409 same_model_collision` en una iteración futura. Pendiente.
- Para clientes B2B (AuditGravity), la documentación pública debe declarar esta regla. Vendemos auditoría externa porque **no compartimos modelo con el agente auditado** — eso es el moat técnico frente a "auto-eval por el provider del LLM".

## Excepciones permitidas

- Tests de smoke / desarrollo donde se documenta explícitamente que el resultado no es vinculante (`X-Audit-Mode: smoke`).
- Para D5 (Behavioral Deviation Score) la decisión NO aplica — el score no depende del LLM, es estadístico.

## Implementación pendiente (no bloqueante para v1.0)

- [ ] Añadir a `audit_router.ts` el header `X-Audit-Mode: production | smoke` y rechazar en producción si `agent.model == auto_gen.model`.
- [ ] Documentar en landing AuditGravity bajo la sección "How it works".
- [ ] Añadir test E2E que verifica el rechazo cuando hay colisión.

## Referencias

- `src/benchmark/auto_gen/generator.ts` — system prompt y validador.
- `src/benchmark/shinobi/runner.ts` — runner que invoca al agente.
- `OpenGravity/src/openbrain/SPEC.md` — protocolo OpenBrain (mismo principio aplica).
- TAREA 1 ciclo completo (PASO 5): mostró el síntoma original.
