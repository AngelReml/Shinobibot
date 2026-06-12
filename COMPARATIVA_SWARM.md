# Comparativa de enjambres — Shinobi vs swarm-ide (veredicto medido)

忍 · 2026-06-10 · leído del código real de ambos repos.

## La pregunta del operador

> *Si los swarms de Shinobi fueren inferiores a mi otro agente específicamente de
> swarms (swarm-ide), también puedes usar su tecnología.*

## Veredicto en una línea

**No es globalmente inferior — es asimétrico.** Shinobi gana en *cómo ejecuta*
(aislamiento, verificación, firma); swarm-ide gana en *cómo planifica*
(descomposición en DAG, scheduling por roles). Lo correcto no es sustituir uno por
otro: es **poner el cerebro de planificación de swarm-ide encima de los músculos de
ejecución de Shinobi.** Eso es lo que se hizo hoy.

## Dónde gana cada uno (leído del código)

| Dimensión | Shinobi (`agents/swarm.ts`, `team.ts`, `worktree.ts`) | swarm-ide (`backend/app/orchestrator.py`) | Gana |
|---|---|---|---|
| **Aislamiento de mutación paralela** | Cada agente en su **git worktree** + contexto `AsyncLocalStorage`; escrituras confinadas, en paralelo sin pisarse | Lotes paralelos en un workspace; evita choques por diseño del DAG, no por aislamiento físico | **Shinobi** |
| **Verificación** | Bucle E1 (productor→verificador) por subtarea + `objective_verifier` | Revisor LLM único que puede bloquear | **Shinobi** (+ comité) |
| **Prueba/firma** | Provenance Ed25519 + audit en cadena (E7) por agente | — | **Shinobi (único)** |
| **Seguridad de la caja** | Solo tools confinadas unlock; `run_command` bloqueado en worker | Tools por rol; sandbox Docker/local | Empate |
| **Descomposición en DAG** | ❌ tareas planas/independientes, sin dependencias | ✅ planner → subtareas con `depends_on` | **swarm-ide** |
| **Scheduling topológico** | ❌ solo cap de concurrencia | ✅ Kahn → lotes paralelos que respetan dependencias | **swarm-ide** |
| **Pipeline de roles** | parcial (specialist/research/data/docs sueltos) | ✅ architect→coder→reviewer→tester con tools y prompt por rol | **swarm-ide** |
| **Pizarra compartida** | ❌ subtareas independientes | ✅ contexto que acumula salidas entre lotes | **swarm-ide** |
| **Checkpoint + rollback** | conserva ramas de worktree | ✅ checkpoint pre-swarm + restore on-fail | **swarm-ide** |

## Qué se portó (con crédito)

Se trajo la **lógica pura** de orquestación de swarm-ide a Shinobi, fielmente
(mismo Kahn, misma tolerancia de parseo, mismo guard de ciclo), adaptada a las
tools reales de Shinobi y a su **comité** como revisor (mejor que el revisor único
del original):

- **`src/agents/swarm_plan.ts`** (núcleo puro, sin red, unit-testable):
  - `parsePlan(raw)` — JSON tolerante del planner → subtareas con rol y `dependsOn`.
  - `schedule(subtasks)` — orden topológico (Kahn) en **lotes paralelos**; lanza
    ante ciclo o dependencia desconocida.
  - `reviewRejected`, `budgetExceeded`, `renderPlan`, `ROLE_TOOLS`, `ROLE_PROMPT`,
    `PLANNER_PROMPT`.
  - **Verificado: typecheck limpio + 9/9 verde en Node** (parseo tolerante, lotes
    `[[t1],[t2],[t3,t4]]`, detección de ciclo y de dep desconocida, bloqueo del
    revisor).

Crédito explícito en la cabecera del fichero: lógica del propio operador
(`swarm-ide/backend/app/orchestrator.py`).

## Lo mejor de los dos (la arquitectura resultante)

```
  objetivo
     │
     ▼   swarm_plan.parsePlan + schedule   ← CEREBRO portado de swarm-ide
   DAG de subtareas con rol → lotes paralelos
     │
     ▼   por cada lote, team.ts            ← MÚSCULO propio de Shinobi
   cada subtarea en su git worktree aislado, verificada (E1), firmada (E7)
     │
     ▼   reviewer = committee_review        ← comité de Shinobi (mejor que 1 revisor)
   pizarra acumula salidas; checkpoint+rollback si un lote crítico falla
     │
     ▼
   resultado fusionable, con rastro firmado
```

## Lo que falta para cerrarlo (cableado, en tu Windows)

El núcleo de planificación está y probado; el **cableado al runtime** es el resto:

1. Un planner LLM que emita el JSON (usar `PLANNER_PROMPT`) → `parsePlan` → `schedule`.
2. Bucle que, por cada lote, llame a `runTeam` (ya existe) con las subtareas del
   lote, inyectando la **pizarra** (salidas de lotes previos) en el contexto.
3. Tras el lote de `reviewer`, aplicar `reviewRejected` (vía `committee_review`)
   para bloquear/reintentar.
4. Checkpoint pre-enjambre + restore on-fail (Shinobi ya conserva ramas; falta el
   baseline+restore al estilo swarm-ide).
5. Test vitest del núcleo + un E2E pequeño en Windows.

Estimación honesta: el cerebro (lo difícil de diseñar) está hecho y verde; queda
fontanería de integración, no investigación.
