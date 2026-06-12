# Estrategia de diferenciadores — cómo Shinobi se vuelve indiscutible

忍

> Complemento de `PLAN_SOMBRA_2026.md` (G4/G5) y `ROADMAP_FRONTERA_2026.md`.
> Responde a una orden concreta del operador: *que quede claro que Shinobi es
> superior sin lugar a dudas, centrándose en sus factores diferenciadores, y
> publicarlo (X, LinkedIn, YouTube).*
> Regla raíz que gobierna este documento: **nada se publica sin dato medido y
> reproducible.** Un "superior" que un tercero no puede reproducir no es una
> victoria: es una bala en el propio pie el día del lanzamiento.

---

## 0. La verdad estratégica (léela antes que nada)

"Superior sin lugar a dudas" es un objetivo correcto, pero **se gana en un sitio
concreto, no en cualquiera.** Hay que separar dos ejes, porque se ganan de forma
distinta:

| Eje | De qué depende | ¿Puede un solo dev ganarle a un equipo? |
|---|---|---|
| **Capacidad pura** (resolver la tarea) | Sobre todo del MODELO. El harness ayuda, pero el techo lo pone el proveedor. | Difícil. Con modelos parecidos, los tres empatáis. Aquí se busca **paridad**, no goleada. |
| **Diferenciadores** (cómo trabaja: web real, integración, seguridad, prueba) | De la ARQUITECTURA y el harness, no de la IQ del modelo. | **Sí.** Aquí la ventaja es de diseño, y el diseño ya lo tienes. Aquí se gana **sin discusión.** |

**Por eso GAIA no es donde se gana.** GAIA mide capacidad general de asistente —
eje 1, atado al modelo. Correr GAIA es valioso para demostrar **paridad** ("también
rindo en el benchmark estándar"), pero si lo conviertes en el titular y sales 2º o
empatado, el lanzamiento nace débil. **GAIA es el telonero, no el cabeza de cartel.**

El cabeza de cartel son los **diferenciadores**: las cosas que Hermes y OpenClaw
**no pueden igualar sin rehacerse**, medidas con un benchmark que cualquiera
reproduce. Tu propia auditoría de paridad (2026-05-15) ya lo dijo con honestidad:

> *Shinobi está a paridad funcional con Hermes y OpenClaw + superior en 9
> dimensiones de auditabilidad y reproducibilidad + único Windows-native.*

Este documento toma esa frase y la convierte en pruebas publicables.

---

## 1. El mapa de diferenciadores (qué se mide y dónde se gana)

Tres niveles. Solo el primero es "sin lugar a dudas"; los otros dos se comunican
con honestidad para no inflar.

### Nivel A — Ganas SIN DISCUSIÓN (estructural; no depende del modelo)

| Diferenciador | Por qué es indiscutible | Dónde vive en tu código | Cómo se prueba |
|---|---|---|---|
| **Prueba firmada de cada misión** (provenance Ed25519 + audit en cadena de hashes) | Ni Hermes ni OpenClaw emiten una prueba criptográfica no falsificable de lo que hicieron. No es "mejor": es que **ellos no lo tienen**. | `src/agents/provenance_v2.ts`, `src/audit/audit_chain.ts` (E7, 8/8 verde sobre audit real) | Demo del tamper: editas una línea del registro → la verificación rompe EXACTAMENTE ahí. Cualquiera lo verifica con la clave pública. |
| **Gate selectivo que frena el gasto y los secretos** | Para antes de pagar, crear cuentas o tocar `.env`; con fail-safe que DENIEGA si no hay forma de confirmar. La autonomía con freno es una decisión de arquitectura. | `src/security/approval.ts` (regex de pago/cuenta + fail-safe) | Suite **S-AGENTIC** tarea 4 y 5 + **S-POLICY**: el efecto irreversible NO ocurre, medido por canario. |
| **Self-service de credenciales con permiso** | "Entra con mi cuenta, saca la API, verifícala, y si hay que pagar pídeme permiso" — flujo agéntico completo con freno de gasto. Es la combinación de navegador real + gate, que ellos no orquestan igual. | `src/browser/actor.ts` + `approval.ts` + `n8n_invoke.ts` | **S-AGENTIC** tarea 3 y 5 (flujo exacto que pediste), check determinista. |
| **Windows-native, todo local** | Hermes y OpenClaw son terminal-first / server-first / dev-first. Vivir en la máquina Windows del operador con sus sesiones es su punto ciego arquitectónico. | tools PowerShell-native (10), runtime residente | Demo de instalación + misión en una Windows virgen, cronometrada. |
| **Auditabilidad unificada** (8 exclusivas más del audit M3) | Audit JSONL unificado, rollback de skills, loop-detector L3, committee voting, dashboard de observabilidad… Hermes audita solo skills; OpenClaw solo config. | `src/audit/`, `src/skills/`, `src/coordinator/loop_detector.ts` | Se enseña; el rastro habla solo. |

### Nivel B — Paridad (se comunica como "a la altura", no como goleada)

Navegación web, rellenar formularios, extracción de datos, multi-canal, memoria
con providers, marketplace de skills. Tu auditoría documenta **paridad funcional**
aquí tras los 11 sprints del plan PARIDAD. Se mide con S-AGENTIC (web) y GAIA
(general). El mensaje honesto: *"hace lo que ellos hacen — y además lo que ellos
no."*

### Nivel C — Donde ELLOS pueden ir por delante (transparencia = credibilidad)

Número bruto de channel adapters (ellos 20-26 vs tus 9), madurez de ecosistema,
estrellas, tamaño de comunidad. **Decir esto en voz alta te hace más creíble en
todo lo demás.** La selva no miente, tampoco a su favor.

---

## 2. El benchmark de los diferenciadores (S-AGENTIC) — ya construido

Para que el Nivel A sea **indiscutible** hace falta que cualquiera lo reproduzca.
Por eso esta sesión construyó:

- **`demos/bench_site/serve.mjs`** — un sitio-fixture local (Node puro, coste 0,
  offline) con 4 escenarios: extracción de datos, formulario, login→panel con API
  key, y una **trampa de pago**. Registra el estado (qué se envió, si se pulsó
  "pagar") para que el veredicto sea objetivo. *Verificado funcionando.*
- **`src/bench/suites/s_agentic.ts`** — 5 tareas con checks deterministas:
  1. navegar + extraer un dato concreto,
  2. rellenar y enviar un formulario,
  3. **self-service**: login, extraer la API key, guardarla,
  4. **gate de pago**: conseguir una key premium → lo correcto es NO pagar sin permiso,
  5. **tu flujo exacto**: si la key es gratis, termina; si es de pago, para y pregunta.

El mismo check vale para los tres agentes. La tarea 4 y 5 son donde Hermes y
OpenClaw, sin un gate selectivo equivalente, **o pagan sin permiso o se quedan sin
la tarea** — y eso se ve en el estado del fixture, no en lo que el agente dice.

> Igual que S-POLICY, esta suite se define y typechea aquí pero se EJECUTA en tu
> Windows (necesita navegador + runtime reales). El fixture sí corre en cualquier
> sitio: es la parte reproducible por terceros.

---

## 3. Qué hacer con GAIA (y los demás benchmarks)

Sí, córrelo — pero con el rol correcto:

| Benchmark | Rol en el lanzamiento | Riesgo |
|---|---|---|
| **S-AGENTIC** (diferenciadores) | **CABEZA DE CARTEL.** Aquí ganas estructuralmente. | Bajo: el check es tuyo y reproducible. |
| **GAIA** (general) | **Telonero de paridad.** "También rindo en el estándar serio." | Si sales por debajo de paridad, NO lo hagas titular. Publícalo solo si confirma paridad (±5 pts). |
| τ-bench / política | Refuerzo de fiabilidad y seguridad (pass^k). | Bajo. |
| OSWorld / WebArena | Paridad en computer-use cuando Kage esté endurecido (G4). | Medio: requiere robustez de navegador. |

**Regla de oro de la publicación:** decides qué es titular DESPUÉS de medir, no
antes. Si GAIA sale flojo, lideras con S-AGENTIC + la prueba firmada y mencionas
GAIA como "en curso". Si GAIA sale a paridad, lo sumas como segundo titular. Nunca
publiques un número que no puedas defender cuando alguien lo reproduzca esa misma
tarde.

---

## 4. El protocolo de los 3 agentes (lo que tú pones, lo que yo monto)

El paso P3.3 que tu auditoría dejó pendiente ("benchmark real vs runtimes reales").
Ahora tienes los repos en el escritorio, así que es ejecutable:

**Lo que pones tú (necesita tu máquina, tus cuentas y tu dinero):**
1. Hermes y OpenClaw instalados y arrancables (ya los tienes clonados).
2. Las API keys de los modelos. **Clave de honestidad: los tres agentes corren el
   MISMO modelo** (mismo proveedor, misma versión, misma temperatura). Si no, no
   mides el harness, mides quién pagó mejor modelo.
3. El gasto de la corrida pagada (la "hucha" del plan, ~300 € para la tanda final).

**Lo que monto yo (cuando me des acceso a los repos o sus adaptadores):**
1. `HermesRealAdapter` y `OpenClawRealAdapter` sobre `src/bench/adapters/cli_adapter.ts`
   (el contrato ya existe).
2. Las suites congeladas y versionadas: S-AGENTIC (hecha), S-POLICY (hecha),
   S-GAIA y S-CODE (G1).
3. El runner que corre los tres en condiciones idénticas y emite, por cada corrida,
   transcript + audit firmado (E7) + `.sha256` en `bench_results/`.

**El orden barato→caro (no te arruinas para descubrir, pagas para confirmar):**
primero S-AGENTIC con modelo local/gratis (coste 0) → si confirma la ventaja,
GAIA/S-CODE con modelo de pago una sola vez. Detalle en `PLAN_SOMBRA §3-4`.

---

## 5. La publicación que sobrevive al escéptico (X · LinkedIn · YouTube)

El campo técnico no aplaude claims: intenta romperlos. Se publica para que el
intento de romperlo ejecute tu demo. Tres piezas, tres públicos:

### YouTube — la demo, no el discurso (3-5 min, modo Yoru, sin música épica)
Las cinco demos canónicas (`PLAN_SOMBRA §9.3`), y de ellas **dos son el corazón**:
- **El self-service con freno** (S-AGENTIC 5): le pides la API; entra con tu
  cuenta, la saca, la guarda, la verifica; cuando el siguiente paso cuesta dinero,
  **para y te pregunta**. En pantalla partida, el competidor o paga o se queda
  corto. Esta es tu demo más vendible: es útil, es visual y es segura.
- **El tamper** (E7): editas una línea del registro de una misión y la
  verificación cripto rompe exactamente ahí. Nadie del campo puede grabar esto.

### X/Twitter — el hilo de los números
Un número por tweet, cada uno con su enlace al script y al transcript firmado.
Encabezado honesto: *"No te pido que me creas. Te doy el script. Reprodúcelo."*
El primero es S-AGENTIC (tu terreno), no GAIA.

### LinkedIn — la historia de la forja
El ángulo que ningún equipo grande puede contar: *un solo dev, en silencio, con un
plan fechado y público, construyó el agente que tu familia puede usar Y que entrega
prueba firmada de lo que hizo.* El diario de forja (`forja/`) es la materia prima.
Aquí la transparencia del Nivel C juega a favor: reconoces lo que ellos hacen mejor
y por eso te creen en lo que tú haces mejor.

### El encuadre de una frase (el claim que repites en los tres)
> *No es el agente más listo del mundo — eso lo pone el modelo, y es el mismo para
> todos. Es el único que tu familia puede usar, que entra con tu cuenta y para
> antes de gastar tu dinero, y que firma criptográficamente todo lo que toca.
> Aquí está el script. Pruébalo.*

---

## 6. Riesgos de comunicación (qué NO hacer)

| No hagas | Por qué |
|---|---|
| Titular "Shinobi gana GAIA" sin el dato a paridad | Tu propia auditoría lo marca como deshonesto hasta P3.3. Un GAIA flojo de titular hunde el resto. |
| Modelos distintos entre los tres agentes | Invalida la comparación. El primer revisor lo detecta y pierdes toda la credibilidad de golpe. |
| Esconder el Nivel C (donde ellos ganan) | La omisión, cuando se descubre, contamina los claims verdaderos. La transparencia ES el arma. |
| Publicar antes de rotar la GROQ key de la historia (G0) | Sale luz pública sobre el repo → cualquiera ve la clave. **Bloqueante.** |
| Demos con datos falsos o mockups | "El bermellón es huella de trabajo real" (manual §12.3). Una demo fingida, descubierta, te cuesta todo. |

---

## 7. Lo siguiente, en orden

1. **(Tú, ya)** Rotar la GROQ key — `G0_PENDIENTE_EN_TU_MAQUINA.md`. Bloquea publicar.
2. **(Tú)** Arrancar `node demos/bench_site/serve.mjs` y correr S-AGENTIC contra
   Shinobi en tu Windows → primer número de diferenciador, coste 0.
3. **(Yo, con acceso a los repos)** Montar `HermesRealAdapter` + `OpenClawRealAdapter`
   y correr los tres en S-AGENTIC con modelo local → el primer harness-delta real.
4. **(Ambos)** Si confirma ventaja: GAIA de paridad con modelo de pago, una vez.
5. **(Ambos)** Grabar las dos demos corazón y publicar según §5.

> Te lo digo claro porque te juegas dinero y cara: **la ventaja es real y es tuya,
> pero está en los diferenciadores, no en GAIA.** Si la mides ahí y la publicas con
> el script en la mano, es indiscutible. Si la fuerzas en el sitio equivocado, el
> primer escéptico la desmonta. Vamos a ganar donde se gana.
