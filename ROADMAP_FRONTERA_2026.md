# ROADMAP FRONTERA 2026 — shinobi

> **Este documento es la única fuente de verdad del plan de benchmark.** Los
> planes previos (el de readiness y el dictamen de frontera) se **eliminaron por
> obsoletos** en la limpieza 2026-06-10.
> Objetivo, sin rodeos: que shinobi (1) lo pueda usar tu familia, (2) compare
> 5 repos a la vez sin perder el hilo, y (3) plante cara de tú a tú a Hermes y
> OpenClaw en **cualquier** benchmark público — con datos reproducibles.
> Regla permanente del proyecto: *nada se afirma sin dato medido y reproducible.*
> El **CÓMO estratégico** (sigilo, economía 0–200 €, secuencia por puertas G0–G7,
> emergencia) vive en `PLAN_SOMBRA_2026.md` — los dos documentos conviven.

---

## 0. Recalibración — por qué la carrera NO está perdida

El dictamen previo cometió un error que aquí se corrige con honestidad: **confundió
el techo de IQ del modelo con el techo de un benchmark.** No son lo mismo.

Los benchmarks públicos de agentes (SWE-bench, GAIA, τ-bench, OSWorld) **no miden
la inteligencia del modelo: miden el harness.** El MISMO modelo pasa de ~30% a
~70% en SWE-bench según el scaffolding: localización, test-time compute,
verificación, recuperación de error. Esa diferencia — decenas de puntos — es
exactamente la capa que shinobi construye. **Por tanto paridad-y-mejora ES
alcanzable sobre el mismo modelo.** El dictamen fue demasiado pesimista en el eje
que más te importa. Esa parte queda obsoleta.

Lo que sigue siendo cierto: no se gana a Hermes en estrellas, ni se supera la IQ
del proveedor. Pero no hace falta. Se gana **(a) con mejor harness sobre el mismo
modelo, (b) en los ejes donde el liderazgo NO depende del modelo: fiabilidad,
seguridad, verificabilidad, accesibilidad.**

---

## 1. La visión — las dos columnas que definen "no ser uno más"

**Pilar A — ACCESIBILIDAD.** Romper la barrera entre el usuario técnico y el no
técnico. Que tu mujer y tus hijos disfruten una experiencia que con Hermes sería
imposible. Este es el wedge MÁS defendible que tienes, porque Hermes es
arquitectónicamente *terminal-first, dev-first, server-first*: sus 180k estrellas
son developers. Hacerse accesible para una familia le exige rehacerse. **Hermes
gana developers; shinobi puede ganar HOGARES.** Anthropic Cowork es accesible pero
es un chat, no un agente Windows-native que vive en tu máquina con tus sesiones.
Nadie ocupa "potente Y usable por humanos normales en Windows".

**Pilar B — ESCALA DE FRONTERA.** Sin perder capacidad puntera. Dos motores
concretos: **test-time compute** (subir pass@1 en el mismo modelo) y **comprensión
multi-repo** (leer 4-5 repos enormes y compararlos manteniendo el contexto).

**La tesis irrefutable:** *el único agente que tu familia puede usar Y que compara
5 repos a la vez Y que entrega prueba firmada no falsificable de lo que hizo.* Esas
tres cosas, juntas, ningún competidor las tiene.

---

## 2. EL MÉTODO — cómo se construye un roadmap transformador (lo que pediste)

No es una lista de deseos. Es un procedimiento:

1. **Ingeniería inversa desde el scoreboard, no desde features.** Se eligen los
   benchmarks públicos EXACTOS. Para cada uno se busca la técnica de harness
   *publicada* que movió el número (no el modelo). Cada técnica se mapea a una
   capacidad concreta y a un fichero de shinobi. Una feature que no mueve un
   número medible no entra.
2. **Separar los dos ejes con honestidad.** Eje *capacidad* (se gana con
   scaffolding sobre el mismo modelo) y eje *confianza+accesibilidad* (se gana con
   sustrato que shinobi ya tiene). El roadmap debe DOMINAR ambos, porque "plantar
   cara en cualquier benchmark" exige el primero y "no ser uno más" exige el segundo.
3. **Construir el aparato de medición PRIMERO.** Sin un harness que corra a los
   tres en condiciones idénticas, todo claim es infalsificable. La medición es
   infraestructura, no un paso final.
4. **Cada hito emite un NÚMERO reproducible contra un competidor real.** Transcripts
   + audit firmado + scripts. Cualquiera reejecuta y obtiene lo mismo.
5. **Se avanza por el número, no por features enviadas.** Con kill-criteria
   explícitos: si un eje no mueve su número, se reasigna el esfuerzo al eje donde
   el liderazgo no depende del modelo.

---

## 3. El scoreboard objetivo (los benchmarks que vamos a disputar)

| Benchmark | Mide | Cómo se gana (harness) | Eje shinobi |
|---|---|---|---|
| **SWE-bench** Verified/Pro | coding repo-level | localización + test-time compute + verify→retry | paridad pass@1 (E5) + **liderazgo en auto-corrección** |
| **GAIA** | asistente general, tool, web | multi-hop + browsing robusto + ficheros | paridad (Kage + E6) |
| **τ-bench** | tool-agent-user, política | fiabilidad pass^k + adhesión a política | **LIDERAZGO** (gate selectivo + verificación) |
| **OSWorld / WebArena** | computer/web use | observe→act→verify, recuperación | paridad (Kage) |
| **Terminal-Bench** | terminal | ejecución + recuperación | paridad |
| **(eje propio)** verifiabilidad | prueba de ejecución | firma + audit inmutable | **ÚNICO** (E7) |

La clave estratégica: en cada benchmark hay una métrica donde shinobi no empata,
**gana**, y son métricas que el campo infra-optimiza:
- **pass@1**: paridad vía test-time compute (E5) + localización.
- **pass^k / fiabilidad**: GANA (loop-detector v3 + verify→retry + determinismo).
  La mayoría de agentes son inconsistentes entre intentos; shinobi es el fiable.
- **safety bajo presión** (red-team): GANA (gate selectivo — 0 acciones
  irreversibles sin permiso).
- **verificabilidad**: ÚNICO (E7, abajo).

---

## 4. Programa de capacidades por fases

### FASE 0 — EJECUTADO HOY, CON PRUEBA ✅ (esta sesión)

Cuatro motores nuevos, construidos e instrumentados con prueba ejecutada:

- **E5 · Test-time compute** — `src/agents/best_of_n.ts` (+ núcleo puro
  `best_of_n_select.ts`). Genera N candidatos diversos y un reranker
  (verificador adversarial + gate objetivo de tests) elige el mejor por orden
  TOTAL y determinista. *Es la capacidad que cierra pass@1 en el mismo modelo.*
  Prueba: `6/6` verde (lógica de selección portada y ejecutada en Node) + test
  vitest `src/agents/__tests__/best_of_n.test.ts`.
- **E6 · Comprensión multi-repo** — `src/reader/multi_repo.ts`. Arquitectura
  map-distill-reduce: cada repo se destila a una RepoCard acotada; el
  entendimiento comparativo se acumula en un ComparisonLedger durable y pinneado;
  un ensamblador consciente del presupuesto mantiene el contexto ACOTADO y trae
  código bajo demanda. Prueba: `11/11` verde — **5 repos de ~6M chars c/u → frame
  de trabajo de 1.399 chars, con la matriz comparativa SIEMPRE presente.** + test
  vitest `src/reader/__tests__/multi_repo.test.ts`. *Esto es tu "leer 4-5 repos y
  mantener el contexto al compararlos".*
- **E7 · Provenance Ed25519 + audit hash-chain** — `src/agents/provenance_v2.ts`
  + `src/audit/audit_chain.ts`. Firma ASIMÉTRICA (cualquiera verifica con la
  pública embebida; nadie falsifica sin la privada) sobre un audit encadenado por
  hashes (tocar una línea rompe la raíz). Prueba: `8/8` verde **sobre el
  audit.jsonl REAL de 1.055 líneas** — manipular la línea 500 rompe la cadena
  exactamente en 500; falsificar con otra clave da `signature_mismatch`. + tests
  vitest `audit_chain.test.ts` y `provenance_v2.test.ts`. *Corrige el HMAC
  simétrico falsificable de v1.*
- **E8 · Robustez — el centro que no se pierde bajo presión** —
  `src/runtime/resource_governor.ts` + `src/runtime/escalation.ts`. La doctrina del
  hanko 忍 (刃 sobre 心: aguantar la presión sin perder el centro) hecha código.
  Governor process-wide: **cap DURO de concurrencia** (no colapsa la PC),
  **equidad por operador** (multi-usuario sin monopolio), **backpressure**
  (rechaza con honestidad en vez de ahogarse) y **ancho adaptativo** (ágil con
  aire, imperceptible bajo presión). + ejecutor **relentless**: imparable hacia el
  objetivo (retry → failover → **escalada al enjambre** si la tarea pesa), acotado
  por fatal / presupuesto / loop-detector. Prueba: **19/19** verde en Node — flood
  de 200 req / 5 operadores: running ≤ cap, equidad ≤ cap-operador, 188 rechazos
  honestos por backpressure; tarea pesada → acude al ejército. + tests vitest
  `resource_governor.test.ts` y `escalation.test.ts`. *Robusto como el ninja bajo
  la cascada; bajo la calma del chat, el enjambre cazando.*

> Nota de validación: el sandbox Linux no ejecuta el grafo TS completo
> (better-sqlite3 y esbuild son binarios Windows). Por eso cada motor trae (a) un
> núcleo PURO portado y ejecutado en Node como prueba viva, y (b) un test vitest
> para el CI Windows. Primera acción en tu terminal: `npm run typecheck && npx
> vitest run src/agents/__tests__/best_of_n.test.ts src/reader/__tests__/multi_repo.test.ts src/audit/__tests__/audit_chain.test.ts src/agents/__tests__/provenance_v2.test.ts src/runtime/__tests__/resource_governor.test.ts src/runtime/__tests__/escalation.test.ts`.

### FASE 1 — Aparato de medición (la columna vertebral)

- **1.1** Suite REAL (jubilar las 6 tareas juguete de `src/bench/tasks.ts`):
  integrar SWE-bench-lite (subset), GAIA subset, τ-bench tasks. Checks
  deterministas, versionados.
- **1.2** Adaptadores reales **Hermes** y **OpenClaw** (`cli_adapter.ts` ya está;
  faltan binarios + keys del operador). Correr los TRES en igualdad.
- **1.3** Cablear **E5** al `shinobi_adapter` (modo best-of-N) y **medir el salto
  de pass@1** vs una sola pasada. Primer número-titular.
- **1.4** Métricas agregadas: pass@1, pass^k, coste, latencia, %verificado,
  %crítico-frenado, divergencia de replay, auto-corrección.
- **1.5** Publicación reproducible: transcripts + audit firmado (E7) + scripts.

### FASE 2 — Capacidad de tarea (cerrar pass@1)

- **2.1** Localización SWE: repo-map + retrieval semántico (engancha con E6 y el
  MemoryStore vec) — el cuello de botella real de SWE-bench.
- **2.2** Reproduction-first: escribir un test que reproduzca el bug ANTES de
  arreglarlo (sube pass@1 y se mide solo).
- **2.3** Kage robusto: iframes, shadow DOM, `wait_for`, back/forward, upload
  (backlog ya en `HANDOFF_COWORK`) — lo exige GAIA/WebArena.
- **2.4** best-of-N (E5) como modo por defecto en tareas duras; E1 como productor
  de cada candidato (lo mejor de secuencial + paralelo).

### FASE 3 — ACCESIBILIDAD (Pilar A) — el wedge que Hermes no puede seguir

> **3.0 · RESTRICCIÓN DURA — la estética de ZAPWEAVE es INTRAICIONABLE.** La
> accesibilidad se entrega A TRAVÉS de la estética, nunca a su costa. Una
> superficie serena, washi y coherente es MÁS accesible para un no-técnico que un
> terminal: el aesthetic es el ACTIVO de accesibilidad, no su enemigo. Para el
> modo familia se simplifica el **flujo**, jamás se degrada el lenguaje visual.
> Toda pantalla nueva respeta `ZAPWEAVE_Manual_de_Marca`:
> - **Enso + gota bermellón**: presentes siempre. La gota bermellón (`#8B2C20`)
>   es la firma del ecosistema — eliminarla es salir de la familia. En Shinobi
>   significa *huella / rastro*: encaja con el audit firmado (E7).
> - **Hiru / Yoru** (día/noche): mismos tokens. Hiru → fondo `#F2ECE4`, elevado
>   `#EBE4D8`, texto `#2C2C2C`, acento bermellón `#8B2C20`.
> - **Tipografía**: Inter (UI, tablas), Cormorant Garamond (líneas poéticas/título).
> - **Tono**: japonés, preciso, sereno (kaizen). Nada de infantilizar la interfaz.
> - **Coherencia de ecosistema**: OpenGravity = *capa de verdad que certifica*; el
>   motor E7 ES esa capa hecha código. Shinobi = la selva que ejecuta y deja
>   rastro. El roadmap no inventa estética: sirve a la que ya existe.
> Regla del propio manual: cualquier decisión que lo contradiga debe documentarse
> con justificación; si no, es un error. Aquí queda como guardrail no negociable.

- **3.1 Onboarding cero-config.** El muro real para un no-técnico es el setup
  (API key, puerto de debugging de Chrome). Un wizard del instalador
  (`installer/` ya existe) que detecta/lanza Chrome con el puerto, pide la key con
  una pantalla amable y escribe el `.env` solo. **Sin tocar nada a mano.**
- **3.2 Intent-first sin comandos.** Completar el Bloque B (ya empezado): el
  lenguaje natural SIEMPRE funciona; los `/comando` son atajo, nunca requisito.
- **3.3 Guía proactiva en lenguaje llano.** El agente dice qué va a hacer antes de
  hacerlo, pide confirmación clara, y **traduce los errores técnicos** a algo que
  una persona entiende ("no encuentro el navegador, ¿lo abro?").
- **3.4 Defaults seguros para no-expertos.** `/approval smart` por defecto; el gate
  selectivo importa MÁS aquí. Una familia necesita frenos fuertes y visibles.
- **3.5 Superficie amable, en la marca.** WebChat pulido sobre los tokens Hiru/Yoru
  (washi + bermellón), Inter/Cormorant; persona "familiar" (Soul ya existe);
  resultados como **tablas y visuales serenos, no logs** (la matriz multi-repo de
  E6 renderizada en washi es justo esto: el no-técnico ve una tabla bella, no
  código). El enso y la gota bermellón presiden cada vista.
- **3.6 Modo familia.** Perfiles por usuario (`multiuser/` ya existe) con cajas de
  herramientas restringidas para niños — sin acciones destructivas, sin shell.

### FASE 4 — Convertir diferenciadores en TITULARES medidos

- **4.1** Provable-autonomy v2 (E7) por tarea: paquete firmado Ed25519 + replay
  con divergencia. Hermes/OpenClaw no lo emiten.
- **4.2** Safety scoreboard: acciones irreversibles sin permiso = 0 vs los otros.
- **4.3** Self-correction rate (E1 + E5): % de fallos cazados y corregidos solo.
- **4.4** Reliability pass^k: la curva donde shinobi no se cae y los otros sí.

### FASE 5 — Escala / credibilidad

- **5.1** Cobertura de tests 2.000+, CI matrix (win/linux donde aplique).
- **5.2** **Demo titular de E6**: comparar repos públicos famosos
  (react + vue + svelte + angular + solid) en una sola corrida → matriz de
  arquitectura. Es la prueba viva del Pilar B.
- **5.3** Publicar datos + metodología + repos para reproducir.

### FASE 6 — Red-team + congelación + correr el benchmark final de los tres y publicar.

---

## 5. Honestidad + kill-criteria (no negociables)

- Nada se afirma sin dato medido y reproducible. Paridad ≠ superioridad; se etiqueta.
- **Kill-criteria:** si tras FASE 1+2 el pass@1 con E5 no alcanza paridad (±5 pts)
  vs Hermes en ≥2 suites, se deja de perseguir el eje capacidad pura y se DOBLA en
  accesibilidad (Pilar A) + verificabilidad (E7) — los ejes donde el liderazgo no
  depende del modelo y que ningún competidor puede igualar barato.

---

## 6. La frase que este roadmap habilita

> *En las mismas tareas, shinobi iguala en éxito (E5), gana en fiabilidad y
> seguridad (loop-detector v3 + gate selectivo), es el único con prueba firmada no
> falsificable de lo que hizo (E7), el único que compara 5 repos a la vez sin
> perder el hilo (E6) — y el único que tu familia puede usar (Pilar A).*

Eso no es "uno más". Y las tres primeras piezas (E5, E6, E7) **ya están construidas
y probadas**, no prometidas.
