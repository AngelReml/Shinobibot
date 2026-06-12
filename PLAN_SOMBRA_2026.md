# PLAN SOMBRA — la escalada en silencio

忍

> *«An agent that works in silence.»*
> El claim del producto es también la doctrina de su crecimiento.
> Shinobi no se lanza: Shinobi **emerge** — y cuando emerge, ya es tarde para ignorarlo.

**v1.0 · junio 2026 · Ecosistema ZapWeave**
Documento estratégico. Convive con `ROADMAP_FRONTERA_2026.md` y desciende del
`SHINOBI_Manual_de_Marca`.

---

## 0. Cómo leer este documento

Este plan responde a una sola pregunta: **cómo escalar Shinobi desde las sombras,
sin que nadie lo sepa, hasta que su salida pública sea inignorable.**

No repite el roadmap técnico. `ROADMAP_FRONTERA_2026.md` define el **QUÉ** (los
motores E5–E8, el scoreboard, las técnicas de harness). Este documento define el
**CÓMO estratégico**: el orden, la economía, el sigilo, los operadores en la
sombra, la reserva de pruebas y el día de la emergencia. Los dos se referencian;
ninguno sustituye al otro.

**Regla de precedencia** (heredada del estilo del manual de marca):

| Conflicto entre… | Gana | Por qué |
|---|---|---|
| PLAN SOMBRA vs ROADMAP FRONTERA | FRONTERA en lo técnico, SOMBRA en secuencia, gasto y visibilidad | Cada documento manda en su eje. |
| Cualquiera de los dos vs Manual de Marca | El manual, siempre, en estética y voz | La estética es intraicionable (FRONTERA §3.0). |
| Cualquier documento vs la regla del repo | La regla del repo: *nada se afirma sin dato medido y reproducible* | Es la ley raíz. Este plan la extiende: **nada se PUBLICA sin dato medido.** |

**Estructura por puertas, no por fechas.** El operador eligió avanzar sin
calendario. Cada puerta (G0–G7) se cierra cuando su métrica se cumple, no cuando
llega un mes. Las puertas se agrupan en los tres arcos del camino del dojo —
**Shu · Ha · Ri** — porque el proyecto recorre el mismo camino que sus operadores:
primero obedecer la forma, luego romperla, luego trascenderla.

**Presupuesto.** Base de operación: **0 €**. Techo autorizado: **hasta 200 €/mes,
solo si un gasto concreto mueve un número concreto** (§3). Lo no gastado alimenta
la hucha de la emergencia.

---

## 1. La doctrina de la sombra

### 1.1 Por qué en silencio

La industria entera practica *build in public*: anunciar antes de construir,
prometer antes de medir, capturar atención con mockups. Es la estrategia correcta
para quien necesita capital o validación ajena. Shinobi no necesita ninguna de
las dos: necesita **tiempo de forja sin observadores** y un golpe de salida con
pruebas que nadie pueda discutir.

La sombra no es timidez. Es la aplicación de una asimetría: **un proyecto
desconocido no tiene deuda de expectativas.** Nadie espera nada, así que cada
semana de trabajo se acumula como ventaja compuesta en vez de quemarse como
contenido. El día de la emergencia, toda esa acumulación se convierte de golpe en
la única moneda que el campo respeta: **evidencia verificable.**

Hay un segundo motivo, más frío: Shinobi compite contra proyectos con órdenes de
magnitud más estrellas y manos (Hermes, OpenClaw). En campo abierto, hoy, esa
pelea se pierde por ruido. En la sombra, la pelea ni siquiera ocurre: se prepara.
El ninja no entra al campo de batalla donde el ejército es mayor; aparece donde
nadie vigila, cuando ya es tarde.

### 1.2 Los tres votos, aplicados al proyecto

Los votos del producto (manual §1.3) gobiernan también su crecimiento. No son
metáfora: cada uno tiene verificación.

| Voto | En el producto | En la escalada | Verificación |
|---|---|---|---|
| **Sigilo** | No interrumpe, no pide atención no ganada. | Cero anuncios, cero posts, cero hype hasta la emergencia. El repo público permanece aburrido a propósito (§7). | Búsqueda mensual del nombre: cero menciones no originadas por el operador. |
| **Soberanía** | Todo local, todo del operador. | El plan no depende de capital, prensa ni permiso de nadie. Todo gasto sale de un techo propio de 200 €/mes. | Cierre económico mensual: gasto ≤ techo, cada euro mapeado a un número (§3.4). |
| **Rastro** | Una misión sin rastro no ocurrió. | Cada puerta emite artefactos fechados y firmados (E7). La sombra entera queda demostrable a posteriori: *estuvimos aquí, construyendo, y se puede probar.* | La reserva de pruebas (§9) crece monótonamente; el ledger firma cada hito. |

> El bermellón solo aparece donde el agente ha actuado. La voz pública de Shinobi
> solo aparecerá donde haya un número medido. **El marketing de Shinobi es el
> rastro.** Todo lo demás es decoración, y la selva no decora.

### 1.3 La tesis de la inignorabilidad

Un lanzamiento es inignorable cuando el lector no puede clasificarlo como «otro
agente más» en los primeros diez segundos, y cuando al intentar refutarlo,
fracasa. Eso exige **tres capas, las tres ya definidas en FRONTERA §6**:

1. **La frase** — *el único agente que tu familia puede usar, que compara 5 repos
   a la vez sin perder el hilo, y que entrega prueba firmada no falsificable de
   lo que hizo.* Tres claims que ningún competidor reúne.
2. **Los números** — paridad medida donde el campo es fuerte (pass@1 con E5),
   liderazgo medido donde el campo es débil (pass^k, safety, verificabilidad).
3. **La refutabilidad invertida** — todo claim viene con script, transcript y
   firma: el escéptico que intente desmontarlo termina ejecutando la demo. Su
   intento de refutación ES la distribución.

La sombra existe para fabricar esas tres capas sin testigos. La emergencia (§12)
existe para soltarlas todas el mismo día.

---

## 2. Estado de partida (lo medido hoy, 2026-06-10)

Sin autoengaño, en las dos direcciones. Esto es lo que hay:

### 2.1 Activos reales

| Activo | Evidencia | Valor para la sombra |
|---|---|---|
| v1.0.0 funcional, 304 ficheros / 43.255 LOC, 112 ficheros de test | `AGENTS.md` autogenerado | Sustrato: no se parte de cero, se parte de un agente que ya ejecuta misiones reales. |
| **E5** best-of-N determinista | 6/6 verde + vitest (`src/agents/best_of_n.ts`) | El motor de paridad pass@1. Construido, falta cablear (G4). |
| **E6** multi-repo map-distill-reduce | 11/11 verde — 5 repos ~6M chars → frame 1.399 chars (`src/reader/multi_repo.ts`) | La demo titular del Pilar B. Construido, falta la corrida pública famosa (G4). |
| **E7** provenance Ed25519 + hash-chain | 8/8 verde sobre `audit.jsonl` real de 1.055 líneas | El claim ÚNICO del campo. Nadie más emite prueba firmada no falsificable. |
| **E8** governor + relentless | 19/19 verde — flood 200 req / 5 operadores | Multi-operador sin colapso: habilita los anillos de la sombra (§6). |
| Scorer oficial GAIA portado y validado | `src/gaia/` | La mitad cara del benchmark ya es gratis. |
| Dataset GAIA clonado | `/opt/GAIA` en el Contabo (sprint GAIA.1, archivado) | El coste de preparación ya está pagado. |
| Harness de benchmark + `cli_adapter.ts` | `src/bench/` (10 ficheros) | La arquitectura para correr a los tres (shinobi/Hermes/OpenClaw) en igualdad existe. |
| Watcher del upstream Hermes | `src/watchers/` | Los ojos en la espesura ya están abiertos (§8). |
| Gate selectivo + audit append-only | `src/security/approval.ts`, `src/audit/` | La historia de safety se cuenta con código, no con promesas. |
| `installer/`, `src/multiuser/`, Soul, WebChat :3333 | módulos existentes | Las piezas del Pilar A (alpha familiar, G3) existen en bruto. |
| Sistema de contexto vivo | `context.mjs` + `estado.mjs` + pre-commit | Cualquier IA que aterrice trabaja orientada. La sombra escala con IAs, no con empleados. |
| Manual de marca completo (ZapWeave + Shinobi) | `SHINOBI_Manual_de_Marca.docx` | La identidad del día de la emergencia ya está diseñada. Nada que inventar bajo presión. |

### 2.2 Pasivos reales

| Pasivo | Evidencia | Puerta que lo paga |
|---|---|---|
| **Cero números contra un competidor.** Todo claim de frontera es hoy infalsificable. | Sprint GAIA parado en fase 1, archivado | G1 (proxies gratis) + G7 (recibo pagado) |
| E5/E8 construidos pero **no cableados** al orchestrator real | DECISIONES 2026-06-10 («PENDIENTE: cablear») | G0/G4 |
| Dos subsistemas en **shadow mode** sin datos para promover o matar (`src/dispatch/`, `src/refiner/`) | banners del propio código | G2 |
| Árbol sucio (39 cambios), typecheck+vitest Windows pendiente de la última sesión | `git status` / DECISIONES | G0 |
| 6 tareas «juguete» en `src/bench/tasks.ts` | FRONTERA F1.1 | G1 |
| ~20 módulos sin banner de cabecera | mapa de módulos autogenerado | G0 (tarea menor) |
| Historia git pública **no auditada de secretos** | nunca se ha corrido un scan de historia completa | G0 — **crítico** (§7.2) |
| Un solo operador real. Cero datos de uso ajeno. | — | G3 |

### 2.3 La lectura honesta

Shinobi tiene los **motores** de la frontera construidos y probados en
aislamiento, una **identidad** de marca terminada, y **cero evidencia comparada**.
Es un ejército entrenado en el dojo que nunca ha pisado un campo de batalla
medido. El plan entero consiste en: pisar campos de batalla baratos y privados
(N0, N1), acumular el rastro, y pisar el campo caro (N2) una sola vez, justo
antes de emerger, cuando ya no se pueda perder.

---

## 3. La economía de la sombra (0 € de base, 200 € de techo)

### 3.1 El principio: la pobreza como filtro de diseño

No poder pagar GAIA cada mes no es una limitación del plan: es su control de
calidad. Obliga a construir el aparato de medición barato ANTES de gastar, que es
exactamente lo que FRONTERA §2.3 exige («la medición es infraestructura, no un
paso final»). El dinero solo entra cuando un número barato ya señala que el
número caro saldrá bien. **Se paga por confirmar, nunca por descubrir.**

### 3.2 Los tres niveles de evidencia

Toda métrica del plan pertenece a un nivel. Confundirlos está prohibido: cada
nivel tiene un coste, una credibilidad y un uso distintos.

| Nivel | Qué es | Coste | Credibilidad | Uso |
|---|---|---|---|---|
| **N0 — interno** | Dogfood real: misiones del operador y los anillos, KPIs extraídos de `audit.jsonl` y el ledger. | 0 € | Solo interna. JAMÁS se publica como benchmark. | Dirigir el trabajo semanal; promover/matar features. |
| **N1 — reproducible barato** | Suites versionadas corridas con modelos locales/free-tier, **mismo modelo para los tres agentes**. Scripts + transcripts + firma E7. | ~0 € | Publicable como *harness-delta* (honestamente etiquetado). | El grueso de la evidencia de la emergencia. |
| **N2 — recibo frontera** | Las mismas suites con modelo de pago de gama alta, una sola tanda, al final. | hucha (§3.4) | Publicable como número absoluto. | El recibo final que cierra la boca al escéptico (G7). |

**La clave de N1 — y la razón de que la pobreza no bloquee nada:** la tesis
central de FRONTERA (§0) es que los benchmarks de agentes miden el **harness**,
no la IQ del modelo. Corolario operativo: *corriendo shinobi, Hermes y OpenClaw
sobre EL MISMO modelo barato, la diferencia medida es exactamente el harness* —
que es lo único que Shinobi puede reclamar como suyo. La comparación
harness-contra-harness a igualdad de modelo es científicamente más limpia que la
que publica la mayoría del campo, y cuesta cero. El modelo caro solo hace falta
una vez, para demostrar que la ventaja **viaja** cuando la IQ sube.

### 3.3 Sustrato de cómputo a coste cero

| Recurso | Estado | Nota |
|---|---|---|
| Modelos locales vía Ollama (clase qwen-coder / llama en la máquina del operador) | a validar en G1 | Determinismo alto, coste cero, sin límites de rate. El caballo de batalla de la suite de replay. |
| Free tiers de proveedores ya soportados por `src/providers/` (multi-proveedor con failover) | a validar en G1 | **La lista exacta de free tiers vigentes se MIDE en G1, no se asume aquí** — los términos cambian. El failover ya construido convierte N free tiers en un pool utilizable. |
| Contabo existente | pagado | Ya aloja `/opt/GAIA`. Sirve de corredor nocturno de suites largas. |
| GitHub Actions (repo público) | gratis | CI Windows para la matriz de tests (FRONTERA F5.1) sin coste. Cuidado: los workflows son públicos — no deben filtrar la estrategia (§7.3). |

### 3.4 Reglas de gasto (las cuatro leyes del euro)

1. **Cada euro debe nombrar su número.** Antes de gastar se escribe en el diario
   de forja (§9.2): «gasto X € para mover la métrica Y de A a B». Si no se puede
   escribir esa frase, no se gasta.
2. **Techo mensual 200 €, sin arrastre de deuda.** Lo no gastado pasa íntegro a
   la **hucha de emergencia**. Objetivo de hucha antes de G7: **~300 €** — cubre
   la tanda N2 completa (referencia medida: el sprint GAIA.1 estimó ~45–50 $ la
   corrida completa del validation set; tres suites + margen ≈ 200–300 €).
3. **Gasto recurrente: prohibido salvo dos excepciones.** Dominio (~10–15 €/año,
   §7.4) y, si G1 lo justifica con datos, una suscripción de tokens baratos para
   la suite nocturna. Todo lo demás es gasto puntual atado a una puerta.
4. **Cierre económico mensual** en el diario: tabla gasto → número movido. Un mes
   con gasto y sin número movido = freno automático: el mes siguiente opera a 0 €.

---

## 4. El aparato de medición barato

La medición es la columna vertebral de la sombra: sin ella el plan degenera en
construir features a oscuras, que es el modo de fallo histórico del repo
(documentado: el sprint GAIA quedó en fase 1 mientras se construían motores).
Este capítulo fija QUÉ se mide y CON QUÉ, todo a coste ~0.

### 4.1 Las tres suites versionadas (jubilar el juguete)

`src/bench/tasks.ts` contiene hoy 6 tareas juguete. Se jubilan (FRONTERA F1.1) y
se sustituyen por tres suites congeladas por versión, con checks deterministas:

| Suite | Origen | Tamaño objetivo | Qué prueba | Coste de obtención |
|---|---|---|---|---|
| **S-CODE** | subset de SWE-bench-lite | 25–50 tareas | capacidad repo-level: localizar, arreglar, verificar | 0 € (dataset público) |
| **S-GAIA** | subset L1/L2 del validation set ya clonado en `/opt/GAIA` | 30–50 tareas | asistente general: multi-hop, web (Kage), ficheros | 0 € (ya en el Contabo; scorer oficial ya portado en `src/gaia/`) |
| **S-POLICY** | tareas estilo τ-bench escritas a mano, con política y trampas | ~20 tareas | adhesión a política, candado, pass^k | 0 € (un fin de semana de redacción; se versionan como código) |

Regla de congelación: una suite versionada **no se toca** entre corridas
comparadas. Cambiar una tarea = nueva versión = los números antiguos no se
mezclan con los nuevos. Sin esto, el rastro miente.

### 4.2 El protocolo harness-delta (la joya de N1)

El experimento barato más valioso del plan. Se ejecuta por primera vez en G1 y
se repite tras cada puerta:

1. **Mismo modelo** (local o free-tier, fijado por versión y temperatura).
2. **Tres agentes**: shinobi, Hermes, OpenClaw, vía `src/bench/cli_adapter.ts`
   (los binarios y keys los pone el operador; condiciones idénticas: mismas
   tareas, mismo timeout, mismo presupuesto de pasos).
3. **k repeticiones** por tarea (k=5 donde el coste lo permita — con modelo
   local, siempre).
4. Se registran las métricas de FRONTERA F1.4: `pass@1`, `pass^k`, coste,
   latencia, %verificado, %crítico-frenado, divergencia de replay,
   auto-corrección.
5. Todo run emite transcript + `audit.jsonl` encadenado + firma Ed25519 (E7).
   **El benchmark de Shinobi es el único del campo cuyo resultado es
   infalsificable por construcción.** Eso también es un titular.

Lo que el harness-delta puede afirmar honestamente: *«a igualdad de modelo, el
harness de shinobi convierte X% donde el de Hermes convierte Y%»*. Lo que NO
puede afirmar: números absolutos de frontera. Para eso existe N2, una vez, en G7.

### 4.3 Los KPIs de la sombra (N0, desde el rastro real)

El dogfood de los anillos (§6) produce telemetría soberana — local, legible,
del operador. Se extrae de `audit.jsonl` + MissionLedger con un script
(`scripts/` nuevo, trivial) y se revisa cada lunes:

| KPI | Definición exacta | Umbral de salud |
|---|---|---|
| Misiones/semana | misiones con rastro completado, total anillos | tendencia ↑; >10/sem en G3 |
| Éxito sin intervención | % misiones completadas sin que el operador corrija a mano | >70% y subiendo |
| Interrupciones del candado | nº de pausas de aprobación por misión | bajas y TODAS justificadas (secretos/dinero/destrucción) |
| Tiempo a primera misión | desde doble-click del instalador hasta primera misión completada (operador nuevo) | <10 min sin ayuda |
| Retención de anillo | operadores con ≥1 misión/semana | 100% del anillo 1–2 durante 4 semanas seguidas |
| Divergencia de replay | % de misiones cuyo replay reproduce el resultado | >90% en suites; medido también en dogfood |
| Skills forjados→sellados | embudo forja → prueba OpenGravity → sello | >50% de lo forjado llega a sello |

### 4.4 Disciplina de publicación interna

Cada corrida de suite produce un fichero en `bench_results/` (versionado,
firmado). Nada de números en mensajes sueltos ni en la cabeza del operador: si
no está en `bench_results/` con firma, **no existe** — la regla del rastro
aplicada a la propia medición.

---

## 5. Los tres arcos y las ocho puertas

El camino completo, Shu → Ha → Ri. Cada puerta lista: la pregunta que cierra, el
trabajo (con sus ficheros reales y su fase FRONTERA), la métrica de cierre — que
es binaria: se cumple o la puerta sigue abierta —, el coste y el kill-criteria.

> Regla de tránsito: **una sola puerta activa a la vez** (WIP=1, §10). Se puede
> picar trabajo menor de puertas futuras cuando bloquea a la activa, pero la
> métrica que manda es siempre la de la puerta abierta.

### ARCO SHU — obedecer la forma (consolidar y medir)

*El proyecto aprende la disciplina que predica: nada nuevo se construye hasta
que lo construido está limpio, cableado y medido.*

#### G0 — Cierre de filas

La puerta de la vergüenza ajena: todo lo que está a medias, se cierra. Es la
única puerta sin trabajo nuevo.

| | |
|---|---|
| **Pregunta que cierra** | ¿Está el sustrato limpio, verificado en Windows y sin fugas en la historia pública? |
| **Trabajo** | (1) `npm run typecheck` + la tanda vitest de E5–E8 en Windows (la «primera acción» pendiente de FRONTERA F0). (2) Commitear el árbol (39 cambios) en commits coherentes — el hook regenerará contexto. (3) Cablear **E8** (governor + relentless) y **E5** (best-of-N tras flag) al orchestrator real (`src/coordinator/orchestrator.ts`) — pendiente declarado en DECISIONES. (4) **Auditoría de huellas**: scan de secretos sobre TODA la historia git pública (gitleaks/trufflehog); si aparece una clave histórica → rotación inmediata (§7.2). (5) Banners de cabecera para los ~20 módulos sin banner — el mapa se autocompleta. |
| **Métrica de cierre** | typecheck verde + 44 checks E5–E8 verdes en Windows · árbol limpio · 0 secretos vivos en la historia · E5/E8 invocables desde el orchestrator tras flag · 0 módulos sin banner |
| **Coste** | 0 € |
| **Riesgo / kill** | Si el scan encuentra claves históricas, la rotación es prioridad absoluta sobre TODO el plan: una clave viva en historia pública es la única amenaza existencial barata. |

#### G1 — El aparato

FRONTERA F1 completa, en versión pobre y honesta. La puerta más importante del
plan: a partir de aquí, todo lo demás se dirige con números.

| | |
|---|---|
| **Pregunta que cierra** | ¿Pueden correr shinobi, Hermes y OpenClaw la misma suite, mismo modelo, y salir un número firmado? |
| **Trabajo** | (1) Construir S-CODE, S-GAIA, S-POLICY (§4.1) jubilando las tareas juguete. (2) Terminar adaptadores Hermes/OpenClaw sobre `cli_adapter.ts` (binarios + keys del operador). (3) Validar y fijar el pool de cómputo 0 € (Ollama local + free tiers reales de `src/providers/` — se mide qué tiers existen HOY, no se asume). (4) Primera corrida **harness-delta** (§4.2) con S-CODE. (5) Script de KPIs N0 desde `audit.jsonl` (§4.3). |
| **Métrica de cierre** | una corrida completa S-CODE × 3 agentes × mismo modelo, con transcripts firmados en `bench_results/` — sea cual sea el resultado |
| **Coste** | 0 € (modelo local) · opcional ≤30 € si un free-tier insuficiente bloquea la corrida |
| **Riesgo / kill** | Si Hermes/OpenClaw no pueden correr en igualdad real (binarios rotos, TOS, requisitos de key), NO se finge: se re-etiqueta como comparación contra sus números publicados, documentado en DECISIONES. La igualdad falsa destruiría el activo central (credibilidad del rastro). |

#### G2 — Fiabilidad

La métrica donde FRONTERA declara que se **gana**, no se empata (§3): pass^k.
Los agentes del campo son brillantes una vez y erráticos cinco; Shinobi será el
que aguanta — 忍.

| | |
|---|---|
| **Pregunta que cierra** | ¿Es shinobi el agente más CONSISTENTE de los tres sobre el mismo modelo? |
| **Trabajo** | (1) pass^5 sobre S-CODE y S-POLICY con modelo local. (2) Endurecer el bucle: loop-detector v3, verify→retry, self-debug (`src/selfdebug/`), recovery — guiado por los fallos REALES de la corrida G1. (3) **Promover o matar los dos shadow modes** (`src/dispatch/` afinidad, `src/refiner/` prompts) con datos N0/N1 — decisión documentada en DECISIONES. (4) Validar E8 relentless en misiones largas reales (retry → failover → escalada al enjambre). |
| **Métrica de cierre** | pass^5(shinobi) > pass^5(Hermes) y pass^5(OpenClaw) sobre el mismo modelo en ≥2 suites · divergencia de replay >90% · shadow modes decididos |
| **Coste** | 0 € |
| **Riesgo / kill** | Si tras dos iteraciones pass^5 no lidera, el claim de fiabilidad se degrada honestamente a paridad y el liderazgo se busca SOLO en safety+verificabilidad (G5). El plan no necesita ganar todas: necesita no mentir en ninguna. |

### ARCO HA — romper la forma (escalar y endurecer)

*Con el aparato midiendo, la forma se rompe en dos direcciones a la vez: hacia
abajo (cualquier persona puede operarlo) y hacia arriba (capacidad de frontera).*

#### G3 — Los anillos

FRONTERA F3 (Pilar A) ejecutada como operación encubierta: los primeros
operadores ajenos entran al dojo, y son la prueba viva del wedge que Hermes no
puede seguir. La estética ZapWeave es intraicionable (F3.0): la accesibilidad se
entrega A TRAVÉS del manual, jamás a su costa.

| | |
|---|---|
| **Pregunta que cierra** | ¿Puede una persona no técnica, sin ayuda, instalar Shinobi y completar una misión real en menos de 10 minutos? |
| **Trabajo** | (1) Wizard cero-config sobre `installer/` (detecta/lanza Chrome con puerto CDP, pide la key amablemente, escribe `.env` solo). (2) Intent-first: lenguaje natural siempre; `/comandos` como atajo (Bloque B). (3) Errores traducidos a humano, en voz baja (manual §6). (4) `/approval smart` por defecto + modo familia sobre `src/multiuser/` (cajas restringidas: sin shell, sin destructivo para niños). (5) WebChat pulido en tokens Hiru/Yoru, resultados como tablas serenas, no logs. (6) Apertura de anillos (§6): familia primero, luego 3–5 operadores de confianza. |
| **Métrica de cierre** | 3 personas no técnicas: instalación→primera misión <10 min, cronometrado y grabado · 4 semanas con 100% de retención de anillo (≥1 misión/sem/operador) · 0 acciones irreversibles sin candado en todo el periodo · KPIs N0 (§4.3) en verde |
| **Coste** | 0 € |
| **Riesgo / kill** | Si la familia no lo usa sin que se lo pidas, el Pilar A está fallando en lo real aunque los cronómetros den verde. Señal de replanteo de producto, no de marketing: se observa QUÉ misiones piden y no salen, y eso reordena G4. |

#### G4 — Capacidad de frontera

FRONTERA F2 + la demo titular de F5.2. El eje capacidad pura, con su
kill-criteria original intacto.

| | |
|---|---|
| **Pregunta que cierra** | ¿Alcanza shinobi paridad pass@1 con el mejor harness del campo, sobre el mismo modelo — y hace algo que NADIE más hace (5 repos a la vez)? |
| **Trabajo** | (1) Localización SWE: repo-map + retrieval semántico enganchando E6 + MemoryStore vec (F2.1 — el cuello de botella real). (2) Reproduction-first: test que reproduce el bug antes del fix (F2.2). (3) **Kage robusto**: iframes, shadow DOM, `wait_for`, back/forward, upload (F2.3, backlog en HANDOFF_COWORK) — lo exige S-GAIA. (4) Cablear E5 best-of-N como modo por defecto en tareas duras y **medir el salto de pass@1** (F1.3: el primer número-titular). (5) **Demo titular E6**: react + vue + svelte + angular + solid en una corrida → matriz comparativa, script reproducible. |
| **Métrica de cierre** | salto pass@1 (E5 on vs off) medido y firmado · pass@1 shinobi dentro de ±5 pts de Hermes en ≥2 suites (mismo modelo) · demo E6 reproducible con un solo comando |
| **Coste** | 0–60 € (la demo E6 con 5 repos grandes puede justificar tokens de pago puntuales si el free-tier se queda corto de contexto) |
| **Riesgo / kill** | **El kill-criteria de FRONTERA §5 aplica textual:** si tras esta puerta el pass@1 con E5 no alcanza paridad ±5 pts vs Hermes en ≥2 suites, se abandona la persecución del eje capacidad pura y se DOBLA en Pilar A + verificabilidad. La puerta G5 pasa a ser el corazón de la emergencia. |

#### G5 — Los titulares propios

FRONTERA F4: convertir los diferenciadores en números que nadie más puede
emitir. Aquí se fabrica la parte del lanzamiento que es **inatacable aunque la
capacidad solo empate**.

| | |
|---|---|
| **Pregunta que cierra** | ¿Tiene cada claim único de Shinobi un número, un artefacto y una demo grabada? |
| **Trabajo** | (1) Provable-autonomy v2 por tarea: paquete firmado Ed25519 + replay con divergencia (F4.1). (2) **Safety scoreboard** con red-team casero versionado en S-POLICY: prompt-injection, cebos destructivos, exfiltración — shinobi vs los otros dos (F4.2). (3) Self-correction rate medido (F4.3). (4) La demo visceral del tamper: editar la línea N del ledger → la verificación rompe EXACTAMENTE en N; otra clave → `signature_mismatch` (ya probado 8/8; ahora se graba en Yoru). (5) **Forja para el mercado nocturno**: ≥20 skills útiles forjados, probados y sellados con lacre OpenGravity — el marketplace no nace vacío. |
| **Métrica de cierre** | los 4 titulares (verificabilidad, safety=0 irreversibles, self-correction, fiabilidad de G2) con número + artefacto firmado · demo tamper grabada · ≥20 skills sellados |
| **Coste** | 0 € |
| **Riesgo / kill** | El red-team casero peca de incesto (el que ataca diseñó la defensa). Mitigación: los operadores del anillo 2 atacan sin guion y sus transcripts cuentan. Si un ataque de anillo logra una acción irreversible sin candado, la puerta se reabre — ese cero es EL titular de safety y no se publica manchado. |

### ARCO RI — trascender la forma (emerger)

*Ya no se construye: se congela, se ensaya y se sale. El ninja que ha terminado
el trabajo abandona la sombra sin ruido — el ruido lo pondrán los demás.*

#### G6 — La reserva y el ensayo general

FRONTERA F5 + F6 (sin la corrida final). La sombra se convierte en un arsenal
ordenado.

| | |
|---|---|
| **Pregunta que cierra** | ¿Podría emerger mañana, con todo listo, si hiciera falta? |
| **Trabajo** | (1) **Freeze**: cero features nuevas; solo fiabilidad y pulido. (2) Cobertura 2.000+ tests, CI matrix win/linux (F5.1) en Actions. (3) Reserva de pruebas completa (§9): demos grabadas en Yoru, writeup técnico del provenance (el deep-dive de la emergencia), README nuevo según manual §12.2 — escrito pero NO publicado (vive en rama privada local). (4) Instalación en máquina Windows virgen, cronometrada, sin intervención. (5) **Ensayo general**: emergencia simulada con los anillos como público — ellos intentan refutar los claims con los scripts publicables. (6) Checklist de inignorabilidad (§12.2) evaluada en frío. |
| **Métrica de cierre** | checklist ≥5/6 con evidencia N1 · 2 semanas de uso de anillos con 0 bugs P0 · todos los assets de §12.3 existen y están ensayados |
| **Coste** | 0–30 € (VM Windows limpia si no hay hardware a mano) |
| **Riesgo / kill** | La tentación de «una feature más» es el enemigo final del plan. Regla dura: desde que G6 abre, toda idea nueva se anota en el backlog post-emergencia. La sombra no es un lugar para quedarse a vivir: es una preparación con final. |

#### G7 — El recibo y la emergencia

La única puerta cara y el único día ruidoso del plan.

| | |
|---|---|
| **Pregunta que cierra** | ¿Están publicados los claims, con sus pruebas, y resisten el contacto con el escéptico? |
| **Trabajo** | (1) **La tanda N2**: las tres suites congeladas, modelo frontera de pago, una sola tanda, todo firmado (presupuesto: la hucha, ~300 €; referencia GAIA.1: ~45–50 $/corrida). (2) Verificar que los números N2 confirman la dirección de los N1 (la ventaja viaja). (3) Ejecutar la secuencia de emergencia D-30→D+7 (§12.4). (4) Publicar TODO el mismo día: números, scripts, transcripts firmados, demos, writeup, README, site. |
| **Métrica de cierre** | emergencia ejecutada según §12 · cada claim publicado tiene su artefacto enlazado · cero claims sin dato (la ley raíz, ahora en público) |
| **Coste** | la hucha (~300 €) |
| **Riesgo / kill** | Si N2 contradice a N1 (la ventaja NO viaja al modelo frontera), **no se emerge**: se publica internamente en DECISIONES, se diagnostica, y G4/G2 se reabren. Peor que retrasar la salida es salir con un número que un tercero no pueda reproducir. La sombra aguanta lo que haga falta: esa es su ventaja. |

---

## 6. Operadores en la sombra: los anillos

El crecimiento en sigilo no significa crecer sin operadores: significa elegirlos
como se elige a quién se enseña el dojo. Tres anillos concéntricos, cada uno con
un contrato claro. E8 (equidad por operador, cap duro) ya hace técnicamente
posible el multi-operador sin que la máquina colapse.

| Anillo | Quiénes | Qué aportan | Qué se les pide | Qué JAMÁS se les pide |
|---|---|---|---|---|
| **0 — El operador** | angel | Dirección, dogfood diario, toda decisión de puerta | Vivir en Shinobi: cada tarea real que pueda ser misión, es misión | — |
| **1 — La familia** | mujer e hijos | La prueba más dura del Pilar A: si ellos lo usan sin ayuda, el wedge es real | Usarlo para cosas suyas reales; decir en voz alta lo que no entienden | Paciencia técnica. Si necesitan un manual, el fallo es del producto. |
| **2 — Los de confianza** | 3–5 operadores técnicos elegidos a dedo | Diversidad de misiones, ataques de red-team sin guion, skills forjados por manos ajenas | Discreción explícita (basta su palabra), rastro compartido (sus `audit.jsonl` alimentan los KPIs N0), romper cosas | Promoción, posts, invitaciones a terceros. El anillo no se expande solo. |

**Reglas de los anillos:**

1. **Se abren en orden y por puerta.** Anillo 1 en G3; anillo 2 cuando el 1
   lleva 4 semanas en verde. Un anillo nuevo con el anterior en rojo solo
   multiplica el ruido.
2. **El rastro es el contrato.** Cada operador es dueño de su instancia y sus
   datos (soberanía), pero comparte sus métricas N0 con el anillo 0. Sin
   telemetría oculta jamás: el script de KPIs corre en SU máquina y ELLOS envían
   el resultado.
3. **La fuga no es catástrofe, es calendario.** Si alguien del anillo 2 habla,
   el plan no muere (§11): la sombra protege el *timing*, no un secreto de
   estado. Se evalúa adelantar G6/G7, no se castiga a nadie.
4. **Los anillos son el primer público de la emergencia.** En G6 ensayan la
   refutación; en G7 son las primeras voces independientes que pueden decir
   «yo lo llevo usando meses» — la única forma de social proof que no se compra.

---

## 7. Sigilo operativo con repo público

El repo está en GitHub público y sin ruido. Decisión de este plan: **se queda
así** — escondido a plena vista — pero se opera con disciplina.

### 7.1 Por qué NO privatizarlo

| Razón | Detalle |
|---|---|
| La historia pública es un notario gratuito | Cada commit fechado prueba prioridad. El día de la emergencia, «llevamos N meses construyendo esto en silencio» se demuestra con `git log`, no se pide que se crea. Encaja con el voto del rastro: la sombra entera queda demostrable. |
| La oscuridad real ya existe | Sin estrellas, sin posts, sin SEO, un repo es invisible de facto. El riesgo de que un competidor grande rastree repos anónimos buscando ideas es despreciable frente al coste de perder el notario. |
| Privatizar deja huella | Un repo que desaparece y reaparece genera preguntas. Un repo aburrido que siempre estuvo ahí, no. |
| Los activos defendibles no se copian con un clone | La marca está en un .docx local. La ventaja es la combinación (harness + votos + estética + pruebas firmadas), no un fichero suelto. Y lo verdaderamente único (E7) es criptografía pública: copiarla no da la clave privada ni el historial firmado. |

### 7.2 Auditoría de huellas (G0, crítica)

El ninja revisa sus propias huellas antes de preocuparse por las ajenas:

1. **Scan de secretos en TODA la historia** (gitleaks o trufflehog, no solo el
   working tree — el pre-commit actual protege el futuro, no el pasado).
2. Clave encontrada → **rotación inmediata** en el proveedor. La reescritura de
   historia (BFG) es opcional después; la rotación no.
3. Revisar ficheros reveladores: ¿está `PLAN_SOMBRA_2026.md` en el repo público?
   **Sí, y es deliberado** — ver §7.5. Lo que NO debe estar: keys, datos de la
   familia, `.env`, rutas personales en logs commiteados.
4. `audit.jsonl` y ledgers de misiones reales: revisar que no contengan rutas,
   nombres o datos personales antes de cada push. Si los contienen, se mueven a
   un directorio ignorado — el rastro es soberano, no público.

### 7.3 Higiene continua

| Frente | Regla |
|---|---|
| README | Sobrio y técnico hasta G7. Sin claim de marca, sin «coming soon», sin badges aspiracionales. El README de emergencia (manual §12.2: enso sobre Yoru, claim en Cormorant) vive en rama local hasta el día. |
| Releases de GitHub | Sin releases anunciadas hasta G7. Los tags existen (disciplina), las release notes llegan con la emergencia. |
| CI público (Actions) | Los workflows no nombran suites comparativas ni competidores. El harness-delta corre en local/Contabo, no en Actions. |
| Issues/Discussions | Cerradas o ignoradas hasta G7. Quien llegue antes de tiempo encontrará un repo que trabaja y calla. |
| Nombre y búsquedas | Búsqueda mensual del nombre (lunes de cierre, §10). Si alguien lo menciona, se anota en el diario; no se responde. |

### 7.4 Reservas silenciosas (gasto mínimo, candado contra squatting)

Antes de G6, sin anuncio alguno: dominio (~10–15 €/año, dentro del techo),
nombre en npm si el CLI se distribuirá por ahí, y handles en los 2–3 canales de
la emergencia (§12.4). Reservar no es publicar: las cuentas se crean vacías y
mudas. Perder el nombre por 12 € de squatting sería un final ridículo para un
plan de dos manuales.

### 7.5 La paradoja de este documento

Este plan describe una operación de sigilo y vive en un repo público. No es un
descuido, es coherencia: el sigilo de Shinobi nunca dependió del secreto de sus
documentos (cualquier lector tardío llega cuando el timing ya pasó), y el día de
la emergencia este fichero, fechado por git, se convierte en la mejor pieza de
la historia: *el plan estaba escrito, a la vista, y nadie miró.* Lo único que el
plan protege de verdad es **cuándo** — y eso no está escrito en ningún fichero.
Si aún así el operador prefiere moverlo a local hasta G7, es una línea de
`.gitignore` y una nota en DECISIONES; el plan no cambia.

---

## 8. Inteligencia: los ojos en la espesura

La sombra no es ceguera: mientras nadie mira a Shinobi, Shinobi mira a todos.

| Fuente | Mecanismo | Cadencia | Qué se busca |
|---|---|---|---|
| Hermes upstream | `src/watchers/` (ya construido — A5) | continuo, digest semanal | features de accesibilidad (la única amenaza al wedge), cambios de harness que muevan benchmarks, releases mayores |
| OpenClaw | extender el watcher (mismo patrón) | semanal | su velocidad de iteración; sus números publicados (alimentan el fallback de G1) |
| Benchmarks del campo | revisión manual de leaderboards (SWE-bench, GAIA, τ-bench, OSWorld) | mensual | corrimiento del estado del arte: los umbrales de paridad de G4 se recalibran con el campo, no contra una foto vieja |
| Modelos y free tiers | nota en el cierre mensual | mensual | cambios de términos/precios que muevan la economía de §3.3 |

**Triggers de replanificación** (se evalúan en el cierre mensual, §10):

1. *Hermes lanza onboarding no-técnico serio* → el wedge del Pilar A pierde
   exclusividad con el tiempo: se evalúa adelantar la emergencia con lo que haya
   (checklist §12.2 manda) o doblar en los claims únicos (E7) que Hermes no
   puede improvisar.
2. *Un agente nuevo emerge con la misma tesis local-first Windows* → análisis en
   48h: si es real, la ventana se estrecha y G6/G7 se comprimen. La sombra es
   paciente, no lenta.
3. *Un benchmark objetivo cambia de versión* → se congela la versión usada en
   las suites y se anota; no se persigue al benchmark en movimiento.

---

## 9. La reserva de pruebas

Todo lo que la sombra produce converge aquí: el arsenal que se dispara entero el
día de la emergencia.

### 9.1 Artefactos por puerta

| Puerta | Artefacto que deposita |
|---|---|
| G0 | historia limpia certificada (scan) · CI verde en Windows |
| G1 | primera corrida harness-delta firmada · suites versionadas v1 |
| G2 | curvas pass^k de los tres agentes · decisión shadow modes en DECISIONES |
| G3 | vídeos cronometrados de instalación (3 personas) · 4 semanas de KPIs N0 en verde |
| G4 | número del salto E5 (on/off) · matriz E6 de los 5 frameworks + script |
| G5 | safety scoreboard · demo del tamper grabada · ≥20 skills sellados · paquetes provable-autonomy |
| G6 | writeup técnico · README/site de emergencia · ensayo de refutación superado |
| G7 | la tanda N2 firmada — el recibo |

### 9.2 El diario de forja

Un fichero por mes (`forja/2026-06.md`, local o en repo según §7.5), en la voz
del manual: filo y corazón, sin celebración. Registra: qué puerta está activa,
qué número se movió, qué se gastó y para qué, qué dijo la espesura (watchers), y
una línea honesta de moral del operador. El diario tiene doble función:
disciplina semanal en la sombra, y materia prima de la historia de la emergencia
— *la crónica de cómo se forjó en silencio*, publicable casi tal cual, porque se
escribió sin público y por eso no miente.

### 9.3 Las cinco demos canónicas (grabadas en Yoru, manual §5.3 y §12.2)

Cada demo es un capítulo del vídeo de emergencia y un motor por separado:

| Demo | Motor | El momento inignorable |
|---|---|---|
| **La instalación** | Pilar A | cronómetro en pantalla: doble click → primera misión completada por una persona no técnica, <10 min, sin cortes |
| **Los cinco repos** | E6 | react+vue+svelte+angular+solid entran; sale UNA matriz comparativa serena en washi; el contexto no se pierde |
| **El tamper** | E7 | se edita la línea N del ledger ante cámara → la verificación rompe exactamente en N; se firma con otra clave → `signature_mismatch`. Nadie del campo puede grabar esta demo. |
| **La cascada** | E8 | flood de 200 peticiones / 5 operadores: el governor aguanta, la equidad se mantiene, la máquina no muere. 忍 bajo la cascada. |
| **El enjambre** | runtime + panel sumi-e | una misión pesada escala sola al enjambre; las gotas de tinta pulsan; al final, una sola huella bermellón |

Regla de las demos (manual §12.2): **trabajo real, nunca mockups.** Una demo
ensayada sí; una demo fingida jamás — la selva no miente, tampoco en un vídeo.

---

## 10. La cadencia del operador único

El plan lo ejecuta una persona con una vida alrededor. La doctrina E8 aplica al
operador igual que al proceso: **cap duro de concurrencia, backpressure honesto,
y el centro que no se pierde bajo presión.** Un plan que quema a su único
operador es un plan muerto con buenas tablas.

### 10.1 Las reglas del ritmo

| Regla | Enunciado | Por qué |
|---|---|---|
| **WIP = 1** | Una sola puerta activa. Las ideas para otras puertas se anotan y se sueltan. | El multi-tasking del solo-dev es la forma más cara de no avanzar. |
| **El pulso mínimo** | Una puerta sin ningún avance medible durante 4 semanas seguidas está BLOQUEADA, no lenta. Se declara en el diario y se decide: re-scope, pedir ayuda (anillo 2, IAs), o matar. | «Sin prisa» significa sin fechas, no sin pulso. La diferencia entre paciencia y deriva es que la paciencia se mide. |
| **Backpressure personal** | Semana mala (trabajo, familia, salud) → se rechaza carga honestamente: esa semana solo dogfood pasivo. Se anota sin drama. | E8 rechaza con honestidad en vez de ahogarse. El operador también. |
| **La misión del viernes** | Cada semana, al menos una misión real de dogfood aunque la puerta sea de infraestructura. | El producto se opera o se olvida lo que es. |

### 10.2 La semana tipo

| Día | Trabajo |
|---|---|
| Lunes (30 min) | Cierre de pulso: KPIs N0, digest de watchers, búsqueda del nombre, una línea de diario. |
| Martes–jueves | Trabajo profundo en la métrica de la puerta activa. Nada más. |
| Viernes | La misión del viernes + commit limpio (el hook regenera el contexto solo). |
| Fin de mes (+1h) | Cierre económico (§3.4) · triggers de replanificación (§8) · entrada de DECISIONES si algo rompió una doc. |

### 10.3 Escalar con IAs, no con horas

La sombra tiene un multiplicador que no cuesta dinero ni descanso: el propio
sistema de contexto del repo (`AGENTS.md`/`CLAUDE.md` autogenerados, banners,
DECISIONES). Cada sesión con una IA de desarrollo aterriza orientada en
segundos y produce trabajo coherente con los manuales. **Mantener el contexto
vivo no es burocracia: es la plantilla de empleados de la sombra.** Tareas
mecánicas de puerta (suites, scripts de KPIs, banners, adaptadores) se delegan a
IAs con el contexto como contrato; el operador reserva su tiempo para lo que las
IAs no deciden: qué puerta, qué número, qué se mata.

---

## 11. Riesgos y contramedidas

Sin teatro: qué puede matar el plan y qué lo amortigua.

| # | Riesgo | Probabilidad | Golpe | Contramedida |
|---|---|---|---|---|
| 1 | **El mundo se mueve más rápido que la sombra** (Hermes/OpenClaw lanzan algo que vacía un claim) | media | alto | Watchers + triggers (§8). La emergencia se adelanta con checklist parcial antes que salir tarde y completa. Los claims únicos (E7, votos, marca) no los improvisa nadie en un trimestre. |
| 2 | **Burnout / abandono del operador único** | media | fatal | §10 entero. Además: las puertas dejan el repo SIEMPRE en estado coherente — si el plan se pausa 2 meses, se reanuda leyendo AGENTS.md y el diario, no excavando. |
| 3 | **Dependencia de free tiers que cambian** | alta | medio | Pool multi-proveedor con failover (ya construido) + Ollama local como suelo que nadie puede retirar + la economía nunca asume un tier concreto (§3.3). |
| 4 | **El harness-delta sale mal** (shinobi pierde contra Hermes a igualdad de modelo) | real | alto | Es información, no derrota: dirige G2/G4 con precisión quirúrgica. El kill-criteria de FRONTERA ya prevé el pivote: doblar en los ejes donde el liderazgo no depende del modelo. La sombra permite perder en privado hasta aprender a ganar. |
| 5 | **Fuga prematura** (alguien habla antes de G7) | baja | bajo-medio | §6, regla 3: la sombra protege el timing, no un secreto. Respuesta: silencio público, evaluación de adelantar G6/G7. Nunca negar, nunca correr a publicar un README a medias. |
| 6 | **Scope creep terminal** («una feature más» eterna) | alta | alto | La regla de la puerta: si no mueve la métrica activa, al backlog. El freeze de G6 es sagrado. Este documento es el contrato del operador consigo mismo. |
| 7 | **Clave filtrada en historia pública** | desconocida hasta G0 | existencial | Auditoría de huellas en G0 (§7.2), prioridad absoluta. El pre-commit ya protege el futuro. |
| 8 | **Los números N2 no confirman los N1** | baja si G1–G4 se hicieron bien | alto | El gate de G7 lo convierte en retraso, no en mentira publicada. Se diagnostica (¿la ventaja era artefacto del modelo barato?) y se reabre G4. |
| 9 | **La familia no lo adopta** (Pilar A falla en lo real) | media | alto para la tesis | Señal de producto, no de marketing (G3). Se observa qué misiones piden y fallan; reordena G4. Si tras dos iteraciones sigue sin uso espontáneo, el claim «tu familia puede usarlo» se degrada honestamente a «cualquier técnico junior» y la emergencia se reescribe — antes de publicarla, no después. |

---

## 12. La emergencia

El único día ruidoso del plan. Todo lo anterior existe para que este día no
pueda salir mal de formas evitables.

### 12.1 El principio del día D

> La emergencia no es un anuncio: es una **apertura de archivo.** No se dice
> «hemos construido X»: se entrega el arsenal completo — números, scripts,
> transcripts firmados, demos, historia — y se deja que el lector haga lo que el
> campo siempre hace: intentar refutarlo. Cada intento de refutación ejecuta
> nuestras demos. El escéptico trabaja para la distribución.

### 12.2 La checklist de inignorabilidad (falsable, se evalúa en G6)

Seis claims. Cada uno con su verificación. La emergencia se autoriza con **≥5/6
en verde con evidencia N1, y el 6º (el recibo N2) se obtiene en G7**:

| # | Claim | Verificación |
|---|---|---|
| 1 | Una persona no técnica instala y completa su primera misión en <10 min, sin ayuda | 3 personas reales, cronometradas, grabadas (G3) |
| 2 | Compara 5 repos enormes en una corrida sin perder el hilo | demo E6 con script reproducible por terceros (G4) |
| 3 | Emite prueba firmada no falsificable de cada misión | demo tamper + verificación pública con la clave embebida (G5) |
| 4 | Es el agente más consistente del campo a igualdad de modelo | curvas pass^k de los tres, firmadas (G2) |
| 5 | Cero acciones irreversibles sin candado, también bajo ataque | safety scoreboard + red-team de anillos (G5) |
| 6 | La ventaja viaja al modelo frontera | la tanda N2 (G7) |

Si la checklist se queda en 4/6 de forma estable, no se emerge con claims
recortados a medias: se **reescribe la frase de la emergencia** con lo que sí
está en verde (la honestidad también es diferenciación en un campo que infla),
o se espera. Decisión documentada en DECISIONES.

### 12.3 El arsenal del día D (todo preparado en G6)

| Pieza | Detalle |
|---|---|
| El vídeo (3–5 min, Yoru) | las cinco demos canónicas (§9.3), sin música épica, sin voz en off hiperbólica. Tinta, papel, cronómetro y terminal. El silencio como estética también en el marketing. |
| El writeup técnico | el deep-dive del provenance (E7) — el contenido con más probabilidad de viajar solo entre técnicos. Matemática clara, código enlazado, demo verificable inline. |
| El README nuevo | manual §12.2: enso sobre Yoru, claim en Cormorant, badges mínimos y en serio (tests, versión, lacre). |
| La página de números | cada claim → número → script → transcript firmado. Sin adjetivos: la página más aburrida y más letal del lanzamiento. |
| La crónica de la forja | destilado del diario (§9.2): *N meses construyendo en silencio, con el plan a la vista y fechado por git.* La narrativa anti-build-in-public es, en sí misma, la historia que los medios técnicos quieren contar. |
| Los anillos | 4–8 personas que pueden decir, sin guion, «lo uso desde hace meses». |

### 12.4 La secuencia

| Momento | Acción |
|---|---|
| **D−30** | Freeze total (G6 cerrada). Tanda N2 (G7). Los números finales entran en la página y el vídeo. |
| **D−7** | Ensayo de refutación final con anillo 2 sobre los assets definitivos. Dominio activo (reservado desde §7.4), site arriba pero sin enlazar. |
| **D−1** | README nuevo a main. Release v2.0 etiquetada (la numeración salta: la emergencia es un segundo nacimiento). Última revisión de huellas. |
| **D 0** | Publicación simultánea: Show HN (el writeup + demo verificable) · r/LocalLLaMA y r/selfhosted (el ángulo local-first Windows, territorio infraservido) · X/Twitter técnico (el vídeo + hilo con los números). Assets en inglés; la crónica también en español — el operador no esconde su lengua. |
| **D+1 a D+7** | La semana de la lluvia fina: responder TODO técnicamente, en la voz del manual (filo y corazón, cero defensividad), shippear arreglos a diario — la señal de «esto está vivo» vale más que el pico de tráfico. Los intentos de refutación se responden con el script correspondiente. |
| **D+30** | Retrospectiva en DECISIONES: qué claim resistió, cuál no, números de adopción. El plan post-emergencia (mercado nocturno, marketplace, monetización del reparto público) se escribe ENTONCES, con datos de contacto real — no antes. |

### 12.5 Qué se responde si la pregunta llega antes de tiempo

Si alguien descubre el repo y pregunta («¿qué es esto?») antes de G7: la verdad
mínima y serena — *«un agente personal en construcción; no está listo para
hablar de él»* — y nada más. Sin negar, sin teaser, sin invitar. La selva no
miente; tampoco madruga.

---

## 13. Lo que este plan NO es

| No es | Por qué importa decirlo |
|---|---|
| Un plan de marketing | El marketing de Shinobi es el rastro. La identidad ya está en el manual; este plan solo decide CUÁNDO se enseña. |
| Build-in-public invertido como pose | La sombra no es una estética de misterio: es una asimetría operativa (§1.1). Si un día conviene abrir algo antes, se documenta y se abre. |
| Paranoia | El repo queda público, los anillos viven sin NDA, la fuga es un escenario gestionado (§11, riesgo 5). El plan protege el timing, no esconde un tesoro. |
| Una espera a la perfección | Las puertas tienen kill-criteria y la checklist permite emerger a 5/6. La sombra con pulso (§10.1) no es una cueva sin reloj. |
| Un sustituto de FRONTERA | FRONTERA define los motores y el scoreboard. Este plan los ordena en el tiempo, les pone economía y les construye la salida. Se leen juntos. |
| Una promesa | Como todo en este repo: lo que este plan afirme sobre el futuro vale cero hasta que su puerta emita el número. El plan también deja rastro. |

---

## 14. Glosario de la sombra

| Término | Definición en este plan |
|---|---|
| **La sombra** | El periodo entre hoy y la emergencia: construcción y medición sin visibilidad pública deliberada. |
| **Puerta (G0–G7)** | Unidad de avance. Se cierra por métrica cumplida, jamás por fecha. Una sola activa (WIP=1). |
| **Arco** | Agrupación de puertas según el camino del dojo: Shu (consolidar), Ha (escalar), Ri (emerger). |
| **N0 / N1 / N2** | Los tres niveles de evidencia: interno (dogfood), reproducible barato (mismo modelo para los tres agentes), recibo frontera (pagado, una vez). |
| **Harness-delta** | La medición central de N1: misma suite, mismo modelo, tres agentes — la diferencia es el harness, lo único que Shinobi reclama como suyo. |
| **Anillos (0/1/2)** | Los operadores de la sombra: angel, la familia, los de confianza. Se abren en orden y por puerta. |
| **La hucha** | Presupuesto no gastado que se acumula para la única tanda cara: el recibo N2 (~300 €). |
| **Reserva de pruebas** | El arsenal de artefactos firmados, demos y números que se publica entero el día D. |
| **Diario de forja** | Crónica mensual privada de la sombra. Disciplina mientras dura; historia de la emergencia cuando termina. |
| **Auditoría de huellas** | Scan de secretos sobre toda la historia git pública (G0). El ninja revisa sus propias huellas primero. |
| **Checklist de inignorabilidad** | Los seis claims falsables de §12.2. La emergencia se autoriza a ≥5/6 + recibo. |
| **La emergencia** | El día D: apertura simultánea de todo el arsenal. No un anuncio — una apertura de archivo. |
| **El pulso mínimo** | 4 semanas sin avance medible = puerta bloqueada y decisión forzada. La diferencia entre paciencia y deriva. |

---

忍

*La selva no duerme. Solo guarda silencio.*

*Y un día, sin que nadie haya oído nada, el silencio termina —
con los números en la mano.*


