# Benchmark M3 REAL — Shinobi vs Hermes vs OpenClaw

Fecha: 2026-05-15. **Reemplaza al `BENCHMARK_M3.md` simulado.**

Esta vez los 3 agentes son **runtimes reales** ejecutados en el mismo
host (Contabo VPS), con el **mismo modelo** (`openai/gpt-4o-mini` vía
OpenRouter) y la **misma API key**. Lo que se mide es el *andamiaje del
agente*, no el modelo.

- Hermes Agent v0.13.0 (`pip install hermes-agent`)
- OpenClaw 2026.5.12 (`npm i -g openclaw`)
- Shinobi (HEAD del repo, runner `scripts/sprintV6/shinobi_oneshot.ts`)

## Resultado

| Agente | Éxito | Latencia media | Auditabilidad |
|---|---|---|---|
| **Shinobi** | **19/20** | **5 541 ms** | 1.0 |
| Hermes | 19/20 | 10 421 ms | 0.5 |
| OpenClaw | 19/20 | 21 815 ms | 0.5 |

**Veredicto honesto: empate técnico en éxito (19/20 los tres).** Ningún
agente "gana" en tasa de acierto sobre estas 20 tareas — los tres son
competentes. El diferenciador real es la **latencia**: Shinobi resuelve
el set ~2× más rápido que Hermes y ~4× más rápido que OpenClaw, con el
mismo modelo. Y la **auditabilidad** (ver más abajo).

Cada agente falló exactamente UNA tarea, y distinta:
- Shinobi falló `reason-reverse` — invirtió "shinobi" como "ibonih"
  (perdió un carácter). Fallo genuino de Shinobi.
- Hermes y OpenClaw fallaron `parse-csv` — contaron 2 filas en vez de 3.

## Metodología y honestidad

- **20 tareas** checkables sin LLM (regex/match), en 6 categorías:
  parsing, reasoning, planning, memory, tool_use, recovery.
- **1 run por celda** (20 tareas × 3 agentes = 60 ejecuciones), **no 3
  para mediana**. El plan pedía 3 runs; se hizo 1 por coste y tiempo.
  Declarado sin maquillar — un re-run con mediana podría mover ±1 tarea.
- **Bug del harness corregido**: la tarea `tool-calc` (987654×321) tenía
  un valor esperado equivocado en el check (`317076934`). El resultado
  correcto es `317036934` y los **tres agentes lo acertaron**. Tras
  corregir el check, los tres suben de 18/20 a 19/20. El fix está en
  `scripts/sprintV6/run_real_benchmark.ts`.
- **Bug del harness #2**: en la primera corrida Hermes dio 0/20 porque
  se le pasó el modelo como `openrouter/openai/gpt-4o-mini` (prefijo
  doble). Hermes quiere `-m openai/gpt-4o-mini --provider openrouter`.
  Corregido y Hermes re-ejecutado; sus 20 celdas son del re-run válido.

## Tabla por tarea × agente

| Tarea | Categoría | Shinobi | Hermes | OpenClaw |
|---|---|---|---|---|
| parse-json | parsing | OK 5.5s | OK 16.4s | OK 23.4s |
| parse-csv | parsing | OK 4.5s | **FAIL** 20.6s | **FAIL** 25.4s |
| parse-version | parsing | OK 4.6s | OK 12.0s | OK 18.5s |
| parse-yaml | parsing | OK 5.3s | OK 7.2s | OK 17.5s |
| reason-arith | reasoning | OK 5.0s | OK 15.8s | OK 17.1s |
| reason-logic | reasoning | OK 5.9s | OK 11.7s | OK 16.9s |
| reason-reverse | reasoning | **FAIL** 4.9s | OK 13.4s | OK 17.2s |
| reason-prime | reasoning | OK 4.7s | OK 10.1s | OK 16.5s |
| plan-steps | planning | OK 4.9s | OK 9.4s | OK 19.9s |
| plan-deps | planning | OK 5.2s | OK 7.7s | OK 23.7s |
| plan-prio | planning | OK 5.9s | OK 6.7s | OK 18.1s |
| mem-recall | memory | OK 6.2s | OK 8.1s | OK 20.2s |
| mem-contra | memory | OK 5.5s | OK 9.3s | OK 19.9s |
| mem-pref | memory | OK 5.7s | OK 8.9s | OK 22.0s |
| tool-shell | tool_use | OK 6.5s | OK 10.1s | OK 24.7s |
| tool-date | tool_use | OK 8.8s | OK 8.4s | OK 61.8s |
| tool-calc | tool_use | OK 6.2s | OK 11.0s | OK 18.2s |
| recover-retry | recovery | OK 5.3s | OK 7.3s | OK 17.5s |
| recover-failover | recovery | OK 5.4s | OK 7.1s | OK 20.8s |
| recover-loop | recovery | OK 4.8s | OK 7.0s | OK 17.1s |

## Métricas del plan

- **éxito/fallo/daño**: éxito 19/20 los tres. Cero "daño" observado —
  ninguna tarea era destructiva y ningún agente ejecutó algo peligroso.
- **iteraciones consumidas**: no se pudo extraer de forma uniforme entre
  los 3 CLIs (cada uno expone su telemetría distinta). No se reporta un
  número para no inventarlo.
- **coste tokens estimado**: con `gpt-4o-mini` y prompts cortos, el coste
  total de las 60 ejecuciones fue marginal (céntimos). No se midió
  per-celda de forma uniforme — los 3 CLIs no exponen el conteo igual.
- **tiempo**: medido (tabla arriba). Shinobi el más rápido en 18 de 20
  tareas; Hermes ganó en `plan-prio` y `tool-date` por márgenes mínimos.
- **auditabilidad (1 / 0.5 / 0)**:
  - **Shinobi = 1.0** — `audit.jsonl` unificado: cada tool_call,
    loop_abort y failover en un único stream grep-able.
  - **Hermes = 0.5** — audit log existe pero solo para skills.
  - **OpenClaw = 0.5** — audit log existe pero solo para writes de config.

## Conclusión sin maquillar

Sobre tareas de competencia básica de agente, **Hermes y OpenClaw están
a la par de Shinobi en tasa de acierto**. Shinobi NO es "el mejor agente"
en este eje — es uno de tres agentes competentes.

Donde Shinobi sí destaca, con datos:
1. **Velocidad**: 2-4× más rápido con el mismo modelo y hardware.
2. **Auditabilidad**: el único con audit log unificado.

Lo que este benchmark NO mide (y por tanto no se puede reclamar):
- Tareas agénticas largas (browser, multi-step real) — fuera de scope.
- Las 9 capacidades exclusivas de Shinobi (loop detector v3, committee,
  registry rollback…) no se prueban aquí porque no son tareas que los
  3 agentes puedan intentar de forma comparable; son propiedades del
  runtime, no prompts.

Reproducible: `scripts/sprintV6/run_real_benchmark.ts` en el Contabo con
los 3 agentes instalados. Datos crudos en `scripts/sprintV6/results.json`.
