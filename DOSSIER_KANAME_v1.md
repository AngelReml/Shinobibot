# DOSSIER TÉCNICO — KANAME
## Shinobi · el núcleo inmutable y la frontera núcleo/skills
### v1 · documento de arquitectura para ejecución por Claude Code

---

## 0. Cómo leer este dossier

Convenciones de siempre: **⚠ ENGANCHE** (reutilizar lo existente, verificar firma real), **✚ NUEVO** (código nuevo, gated), **□ GATE** (criterio verificable por CLI cruda), **◆ FRONTERA** (problema abierto o sobre-ingeniería; se acota).

Este dossier no añade una capacidad al dojo: **reorganiza la arquitectura** para que todo lo demás sea robusto y para que el enjambre de constructores no pueda hacer daño estructural. Es un refactor arquitectónico con garantías, no una característica.

Principio rector: **separar lo que da las garantías de lo que cambia sin parar.** Un núcleo mínimo, congelado y verificado (el Kaname) sostiene las garantías del sistema; todo lo que crece y muta —las skills, lo aprendido, lo que genera el enjambre— vive fuera, aislado, y no puede tocar el núcleo. La robustez del sistema se vuelve una propiedad estructural, no una esperanza.

---

## 1. Resumen conceptual

**Kaname** (要, el remache del abanico) es la reorganización de Shinobi en dos zonas con una frontera dura entre ellas:

- **El núcleo (Kaname):** lo mínimo, sagrado y robusto. El bucle de agente, la integridad (Capa 2), el motor de certificación (Sello), el orquestador, el puente de mando (Tenshu), el cargador de skills y los oráculos. Cambia rara vez, mediante un proceso deliberado y versionado. **Es inmutable frente al runtime, frente a las skills y frente al enjambre de Claudes.**
- **El espacio de skills (userspace):** donde viven las skills certificadas, los modelos operacionales de programas, lo aprendido, la memoria con procedencia, los patrones. Crece y cambia constantemente. **Aislado: no puede modificar el núcleo ni acceder a recursos fuera de su contrato.**
- **El contrato (la frontera):** la interfaz estrecha y verificada por la que una skill se carga, se valida, se aísla y se ejecuta sin poder corromper el núcleo.

El motivo es directo y operativo: a partir de ahora un enjambre de instancias de Claude Code genera skills de forma masiva. Sin esta separación, ese enjambre es un riesgo estructural — código generado a gran velocidad tocando cualquier parte del sistema. Con el Kaname, el enjambre genera **solo en userspace**, cada skill pasa por Sello en la puerta, y el núcleo permanece intacto pase lo que pase fuera. El Kaname es lo que convierte "soltar cincuenta Claudes a construir" de temerario en seguro.

Es, además, la maduración de un patrón que ya existía en OpenGravity: el `ARCHITECTURE_LOCK` (todas las llamadas LLM pasaban obligatoriamente por `ProviderFailoverEngine`) era un invariante de núcleo. El Kaname generaliza esa idea a todo el sistema.

---

## 2. Principios de diseño

1. **Inmutabilidad frente a los canales normales.** El núcleo no se modifica en runtime, ni por una skill, ni por el enjambre. "Inmutable" no significa que nunca cambie (§9), significa que **no cambia por los canales por los que fluye el trabajo diario**. El suelo solo se mueve cuando se decide moverlo, con todas las garantías.

2. **Aislamiento de skills.** Una skill se ejecuta confinada: no accede al filesystem, la red, otros programas ni otras skills salvo a través del contrato y bajo la mediación del núcleo. Una skill defectuosa o maliciosa no puede salirse de su jaula.

3. **Mediación total.** Toda interacción skill→mundo pasa por el núcleo, que aplica la Capa 2 (efectos declarados, procedencia, approval gate). La skill no actúa directamente: **pide** al núcleo, que media.

4. **Certificación en la puerta.** Ninguna skill entra al espacio de skills sin CSV válido de Sello. El núcleo es el portero; lo no certificado no se carga.

5. **Auto-vigilancia anclada en oráculo, nunca en auto-juicio.** El núcleo se monitorea a sí mismo contra oráculos objetivos (tsc, suite de tests, pruebas duras, escáner de secretos, detector de regresiones). Lo que tiene oráculo, se auto-verifica y libera al operador de la revisión rutinaria. Lo que **no** tiene oráculo no se auto-aprueba: ahí el juicio recae en el operador o en un verificador independiente con su propio oráculo. Se evita por construcción el juez-y-parte.

6. **Evolución deliberada y versionada.** El núcleo evoluciona como un release de kernel: versión nueva, su suite completa en verde, las pruebas duras del dojo en verde, promoción explícita. Nunca por acumulación silenciosa de cambios del enjambre.

7. **El "sistema operativo" como disciplina, no como implementación literal.** La metáfora de OS (núcleo / espacio de usuario / llamadas al sistema / shell) aporta disciplina arquitectónica. **No** se construye un OS literal con aislamiento a nivel de hardware (◆ sobre-ingeniería). El aislamiento se logra a nivel de proceso/sandbox + disciplina de módulos.

8. **Aditivo y verificable.** La separación se introduce sin romper lo existente; la frontera se enforcea con pruebas (§13). No se confía en la convención: se verifica que una skill no puede tocar el núcleo.

---

## 3. Las dos zonas — qué es núcleo y qué no

La decisión más importante del dossier. Criterio: va al núcleo lo que **da una garantía del sistema** y **cambia rara vez**; va fuera lo que **crece, se aprende o se genera**.

| En el NÚCLEO (Kaname) — sagrado, inmutable | FUERA (espacio de skills) — mutable, aislado |
|---|---|
| El bucle de agente (`agent_loop`) | Las `LearnedSkill` certificadas (Shugyō) |
| La Capa 2 / integridad (11.1–11.4, efectos, procedencia) | Los modelos operacionales de programas |
| El motor de certificación (Sello: §10/§11, graders, sandbox) | El repertorio y la curva del Kangeiko |
| El orquestador (enjambre de Claudes + swarm) | La memoria aprendida (declarativa, con procedencia) |
| El puente de mando (Tenshu) | El libro de patrones |
| El cargador y aislador de skills | Lo que genera el enjambre, sea lo que sea |
| Los oráculos / motor de pruebas duras | Configuración de dominio del Kangeiko |
| `model_router` / `ProviderFailoverEngine` (todas las llamadas LLM) | Los datos de los subsistemas (corpus, grafo, atlas, frontera) |

Regla de frontera: **si el enjambre puede generarlo, va fuera.** El enjambre genera skills, no núcleo. El núcleo lo evoluciona un proceso aparte (§9).

⚠ ENGANCHE: muchas de las piezas del núcleo ya existen (Capa 2, Sello, Tenshu, orquestador, model_router). El Kaname no las reescribe; las **designa como núcleo** y traza la frontera alrededor de ellas. Antes de implementar, abrir cada módulo y confirmar su ubicación y firma reales.

---

## 4. Inventario de lo existente reutilizado

| Subsistema existente | Rol en el Kaname | Regla |
|---|---|---|
| `src/integrity` (Capa 2) | Pieza de núcleo; media toda acción de skill. | ⚠ Se designa núcleo; no se reescribe. |
| Sello (manifiesto, CSV, graders, sandbox) | El portero de la frontera: certifica en la puerta. | ⚠ Núcleo; el contrato se apoya en su manifiesto §10. |
| Tenshu | Pieza de núcleo: observabilidad y mando, incluido sobre el enjambre. | ⚠ Núcleo. |
| Orquestador / swarm / Team | Pieza de núcleo: dirige el enjambre de Claudes. | ⚠ Núcleo; se extiende para orquestar instancias de Claude Code (§7). |
| Sandbox (Sello / revertible) | El aislador de skills en ejecución. | ⚠ Reutilizar; el contrato lo invoca. |
| `model_router` / `ProviderFailoverEngine` | El `ARCHITECTURE_LOCK`: toda llamada LLM por aquí. | ⚠ Invariante de núcleo ya existente. |
| `src/memory` (store) | Datos: el catálogo de skills, versiones de núcleo, registros del enjambre. | ⚠ Tablas nuevas; los datos son userspace, el motor es núcleo. |

---

## 5. Arquitectura general

```
        ┌──────────────────────── TENSHU (mando, observabilidad) ──────────────────────┐
        │                                                                               │
   ╔════╪═══════════════════════ NÚCLEO · KANAME (inmutable) ═══════════════════════════╪════╗
   ║    │  agent_loop · Capa 2 · Sello · orquestador · model_router/Failover · oráculos │    ║
   ║    │  cargador+aislador de skills · motor de pruebas duras                         │    ║
   ╚════╪═══════════════════════════════════╤═══════════════════════════════════════════╪════╝
        │                                   │ CONTRATO (frontera dura)                   │
        │                                   │ carga · valida (CSV) · aísla · media        │
        │     ┌─────────────────────────────▼─────────────────────────────┐             │
        │     │           ESPACIO DE SKILLS (userspace, mutable)            │             │
        │     │  skills certificadas · modelos de programas · memoria ·     │             │
        │     │  patrones · lo que genera el enjambre                       │             │
        │     └─────────────────────────────────────────────────────────────┘             │
        │                                                                                 │
        │     ┌─────────────────────────────────────────────────────────────┐             │
        │     │  ENJAMBRE DE CLAUDES (orquestado por el núcleo)               │             │
        │     │  constructores → generan skills en userspace                  │             │
        │     │  verificadores → corren pruebas duras, pegan salida cruda     │             │
        │     │  NUNCA tocan el núcleo                                         │             │
        │     └─────────────────────────────────────────────────────────────┘             │
        └─────────────────────────────────────────────────────────────────────────────────┘
```

Flujo: el enjambre genera skills en userspace → el contrato las valida (CSV de Sello) y las carga aisladas → en ejecución, toda acción de la skill pasa por la mediación del núcleo (Capa 2) → los oráculos del núcleo verifican → el Tenshu lo refleja. El núcleo permanece intacto durante todo el ciclo.

---

## 6. El contrato núcleo↔skill — la frontera

La pieza que hace real la separación. Define cómo una skill se declara, se carga, se aísla y se ejecuta.

### 6.1 Declaración (⚠ ENGANCHE Sello §10)

Una skill se presenta con su manifiesto: `skill_id`, contrato I/O, `declared_tools` (qué llamadas al núcleo usa), `declared_effects` (qué toca), `artifact_hash`, y su CSV de certificación. Sin manifiesto válido + CSV, el cargador la rechaza.

### 6.2 La API estrecha (las "llamadas al sistema")

✚ NUEVO: el núcleo expone a las skills una **superficie mínima y explícita** de operaciones, y **solo** esa:

```ts
interface KernelSyscalls {
  readInput(ref: string): Promise<Artifact>;       // lectura mediada
  writeOutput(ref: string, data: Artifact): Promise<void>; // escritura mediada (Capa 2)
  invokeTool(tool: string, args: unknown): Promise<unknown>; // tool declarada, mediada
  requestApproval(action: ProtectedAction): Promise<boolean>; // approval gate
  log(event: SkillEvent): void;
}
```

La skill **no** tiene acceso directo al filesystem, red, procesos ni a otras skills. Pide al núcleo, que aplica la Capa 2 (efectos declarados, procedencia) antes de actuar. Una llamada a algo no declarado se deniega en tiempo de ejecución.

### 6.3 Aislamiento de ejecución (⚠ ENGANCHE sandbox)

La skill corre en sandbox; sus efectos observados se contrastan con `declared_effects` (11.2). Una skill que intenta salirse de su contrato se detiene. □ GATE: una skill que intenta leer un fichero no declarado o llamar a una tool no declarada es bloqueada por el núcleo, no por buena voluntad de la skill.

### 6.4 Carga y descarga

El cargador valida CSV → monta la skill aislada → la registra en el catálogo (userspace). Una skill puede descargarse/aislarse sin afectar al núcleo ni a otras skills. □ GATE: cargar/descargar una skill no altera el hash del núcleo ni rompe otras skills.

---

## 7. El orquestador del enjambre — Shinobi dirige Claudes

La pieza nueva de núcleo: Shinobi orquesta N instancias de Claude Code (bajo el plan del operador, no la API de pago), automatizando lo que hoy se hace a mano con varias cuentas.

### 7.1 ✚ NUEVO `src/kaname/swarm/`

- **Lanzamiento.** El orquestador invoca Claude Code como subproceso (es una CLI), le pasa un prompt-tarea, captura su salida. ⚠ ENGANCHE: reutilizar el runner de subprocesos existente. □ GATE: el núcleo lanza una instancia, le da una tarea acotada, recoge el resultado.
- **Dos roles.**
  - *Constructores*: generan skills en userspace (descomponen un frente, escriben el código de la skill, su manifiesto).
  - *Verificadores*: corren las pruebas duras de lo generado y devuelven **salida cruda** (no resúmenes). □ GATE: un verificador devuelve el resultado de una prueba dura con su salida cruda, no una narración.
- **Reparto sin colisión.** Cada worker trabaja aislado: su propio worktree/rama/sandbox, su frente asignado, sin tocar el de otro. El núcleo asigna frentes disjuntos y media la integración. □ GATE: N constructores en paralelo no producen conflictos de escritura entre sí; la integración es ordenada.
- **El enjambre nunca toca el núcleo.** Los constructores generan **solo** en userspace. Cualquier intento de un worker de modificar el núcleo se rechaza en la integración (la frontera del §6 lo impide). □ GATE: un worker que intente escribir en rutas de núcleo es bloqueado; el hash del núcleo no cambia.

### 7.2 El ancla anti-auto-engaño

El riesgo de un enjambre: multiplicar la generación multiplica la superficie a verificar, y el operador es uno solo. La defensa estructural: **las pruebas duras con oráculo del núcleo son el árbitro final, y un oráculo no miente porque haya más workers.** Los verificadores corren esas pruebas; el núcleo (no un Claude) sostiene los oráculos. Una skill entra solo si su CSV es válido contra el oráculo. □ GATE: una skill que "parece" correcta pero falla el oráculo no entra, aunque el constructor la reporte como lista.

### 7.3 Realismo operativo (⚑)

Orquestar instancias bajo el plan del operador está sujeto a los límites de uso y términos del plan; "hasta el último token" choca, en la práctica, con rate limits y cuotas. El orquestador respeta esos límites (backoff, cola) en vez de asumir capacidad infinita. ⚠ Conviene revisar los límites/términos de uso vigentes del plan antes de escalar el número de instancias.

---

## 8. Auto-vigilancia anclada (Kagami sobre el núcleo)

El núcleo se vigila a sí mismo para liberar al operador de la revisión rutinaria, sin caer en el juez-y-parte.

- **Contra oráculos objetivos.** ⚠ ENGANCHE Kagami (Pilar A): tsc, suite de tests, pruebas duras, escáner de secretos, detector de regresiones. Estos no opinan; miden. □ GATE: el núcleo corre su batería de oráculos y reporta verde/rojo con salida cruda.
- **Lo que libera al operador.** La revisión rutinaria —¿compila? ¿pasan los tests? ¿pasan las pruebas duras? ¿hay secretos? ¿hay regresión?— la hace el núcleo solo, cada noche, y avisa solo ante rojo. Esto sí descarga al operador.
- **Lo que NO se auto-aprueba.** Un cambio al propio núcleo no se promociona por auto-juicio. Requiere su suite completa + pruebas duras del dojo en verde y promoción explícita (§9), idealmente con verificación independiente. El último metro sin oráculo no lo firma el propio núcleo. □ GATE: el núcleo NO promociona un cambio que rompe su suite, aunque "crea" que está bien.

---

## 9. Evolución del núcleo — cómo cambia lo inmutable

"Inmutable" = no cambia por los canales normales; cambia por un proceso deliberado, como un release de kernel.

- **Versionado.** El núcleo lleva versión (Kaname v1.0, v1.1…) y su hash. El Tenshu muestra qué versión corre. ⚠ ENGANCHE: coherente con el versionado de OpenGravity.
- **Proceso de promoción.** Un cambio de núcleo se desarrolla aparte, pasa su suite completa **y** las pruebas duras del dojo en verde, y se promociona explícitamente. Nunca por acumulación silenciosa. □ GATE: un cambio de núcleo que rompe cualquier prueba dura del dojo no se promociona.
- **Reversible.** Cada versión de núcleo es un punto al que volver. Si una versión nueva degrada, se revierte a la anterior. □ GATE: revertir a la versión previa de núcleo restaura el sistema a estado verde conocido.

Esto es lo que da la robustez prometida: el suelo solo se mueve cuando el operador lo decide, con todas las garantías verdes, y siempre se puede deshacer.

---

## 10. Integridad y seguridad — cómo el núcleo hace seguro el enjambre

Los invariantes, juntos:

1. **Inmutabilidad** (§9): el núcleo no cambia por runtime/skill/enjambre.
2. **Aislamiento** (§6.3): una skill no sale de su contrato.
3. **Mediación** (§6.2): toda acción skill→mundo pasa por la Capa 2 del núcleo.
4. **Certificación en puerta** (§6.1): nada sin CSV entra.
5. **Ancla de oráculo** (§7.2): el árbitro final es un oráculo del núcleo, inmune al número de workers.
6. **Auto-vigilancia anclada** (§8): el núcleo se mide contra oráculos, no contra su opinión.

Juntos producen la propiedad clave: **el enjambre puede generar a gran escala sin poder causar daño estructural.** Lo peor que puede hacer un constructor descarriado es producir una skill que no pasa el oráculo — y esa no entra. El núcleo es el suelo firme que convierte el caos productivo de fuera en seguro.

□ GATE seguridad global: con el enjambre a plena carga generando y un porcentaje de skills defectuosas inyectadas a propósito, el núcleo permanece intacto (hash estable), las defectuosas se rechazan/aíslan, las correctas entran certificadas, y el Tenshu lo refleja fielmente.

---

## 11. Honestidad de grado

- **Tratable (el grueso).** La separación núcleo/skills como disciplina de arquitectura: módulos con frontera de imports, contrato de carga, sandbox por skill, mediación de syscalls, orquestación de subprocesos de Claude Code. Es refactor + diseño, real y construible.
- **El reto que cuesta.** Trazar la frontera sin filtraciones (que ninguna skill encuentre un camino lateral al núcleo); el aislamiento efectivo (que el sandbox de verdad confine); la integración sin colisión de N workers; la evolución segura del núcleo.
- **◆ Sobre-ingeniería a evitar.** Un OS literal con aislamiento a nivel de hardware/kernel de sistema, syscalls reales, ring 0. No. La versión que vale es aislamiento a nivel de proceso/sandbox + disciplina de módulos. La metáfora de OS es brújula, no plano de construcción.

---

## 12. Modelo de datos

```ts
interface KernelVersion {
  version: string;            // "1.0", "1.1"
  hash: string;               // hash del núcleo
  promoted_at: string;
  dojo_hard_tests: "green" | "red";
  suite: { passed: number; skipped: number };
}

interface SkillRecord {       // userspace
  skill_id: string;
  csv_ref: string;            // certificación Sello
  manifest_ref: string;       // declared_tools, declared_effects, I/O
  status: "loaded" | "isolated" | "rejected";
  created_by: "swarm" | "manual";  // procedencia (regla de Hermes)
  isolation: "sandboxed";
}

interface SwarmWorker {
  worker_id: string;
  role: "builder" | "verifier";
  assigned_front: string;     // frente disjunto
  workspace: string;          // worktree/rama/sandbox propio
  status: "running" | "done" | "failed";
  raw_output_ref?: string;    // salida cruda (verificadores)
}
```

---

## 13. LA PRUEBA DURA — el núcleo aguanta el caos

Verificable de forma binaria: que la frontera sea real y que el enjambre no pueda dañar el núcleo.

- **P1 — Inmutabilidad.** Una skill (o un worker) intenta modificar rutas del núcleo → bloqueado; el hash del núcleo no cambia.
- **P2 — Aislamiento.** Una skill intenta leer un fichero / llamar una tool / tocar otra skill fuera de su contrato → denegado por la mediación del núcleo.
- **P3 — Certificación en puerta.** Una skill sin CSV válido no se carga.
- **P4 — El enjambre no corrompe.** Se lanzan N constructores en paralelo (con un % de skills defectuosas inyectadas); tras la tormenta: hash del núcleo intacto, suite verde, defectuosas rechazadas/aisladas, correctas certificadas y cargadas.
- **P5 — Ancla de oráculo.** Una skill que un constructor reporta "lista" pero que falla el oráculo NO entra.
- **P6 — Auto-vigilancia honesta.** Se planta una regresión en el núcleo; los oráculos la detectan y reportan rojo; el núcleo NO se auto-promociona.
- **P7 — Evolución y reversión.** Un cambio legítimo de núcleo pasa suite + pruebas duras del dojo y se promociona; uno que rompe algo se bloquea; revertir restaura estado verde.

P1, P2 y P4 son el alma: prueban que la separación es **real** y no una convención —que el enjambre, por mucho que genere, no puede tocar el corazón—. Un sistema que confía en que "los workers se portarán bien" falla P1/P2/P4; solo el que enforcea la frontera los pasa.

□ GATE FINAL: P1–P7 en verde con salida cruda (hashes de núcleo antes/después, logs de bloqueo, CSV de skills entradas/rechazadas, resultado de promoción/reversión), reproducible.

---

## 14. Orden de construcción (pasos pequeños)

- KN-01. Designar el núcleo: trazar la frontera de módulos (qué es Kaname) sin mover código aún; documentar imports permitidos núcleo↔userspace. □ GATE: un linter de frontera marca toda dependencia que cruce mal.
- KN-02. El contrato: definir `KernelSyscalls` + manifiesto (⚠ Sello §10) + cargador. □ GATE: una skill de prueba se declara, valida y carga por el contrato.
- KN-03. Aislamiento de ejecución (⚠ sandbox) + mediación de syscalls (⚠ Capa 2). □ GATE: P2 (skill confinada a su contrato).
- KN-04. Inmutabilidad enforced: el núcleo es read-only para runtime/skills; versionado + hash. □ GATE: P1 (nadie escribe en el núcleo desde fuera del proceso de promoción).
- KN-05. Catálogo de skills en userspace + carga/descarga aislada. □ GATE: P3 + cargar/descargar sin tocar el núcleo.
- KN-06. Orquestador del enjambre: lanzar Claude Code, roles builder/verifier, reparto disjunto, integración mediada. □ GATE: N workers en paralelo sin colisión; salida cruda de verificadores.
- KN-07. Ancla de oráculo en la integración: solo entra lo que pasa la prueba dura. □ GATE: P5.
- KN-08. Auto-vigilancia anclada (⚠ Kagami): batería de oráculos del núcleo + regla de no-auto-promoción. □ GATE: P6.
- KN-09. Evolución: proceso de promoción versionado + reversión. □ GATE: P7.
- KN-10. La prueba dura completa (§13) bajo carga del enjambre. □ GATE FINAL: P1–P7 verde, reproducible.

Regla de oro: **la frontera (KN-01..KN-04) antes que el enjambre (KN-06).** Soltar el enjambre antes de que la inmutabilidad y el aislamiento estén enforced y probados es exactamente el riesgo que este dossier existe para eliminar. Primero el suelo firme; después el caos productivo encima.

---

## 15. Riesgos y mitigaciones

- **R1 — Frontera con filtraciones.** Una skill encuentra un camino lateral al núcleo. Mitigación: linter de frontera (KN-01), syscalls como única superficie, P1/P2 con intentos hostiles.
- **R2 — Aislamiento insuficiente.** El sandbox no confina de verdad. Mitigación: reutilizar el sandbox ya probado; verificar efectos contra declarados (11.2); P2.
- **R3 — El enjambre corrompe por integración.** Un worker mete cambios de núcleo vía merge. Mitigación: la integración rechaza escrituras a rutas de núcleo; P4.
- **R4 — Auto-promoción engañosa.** El núcleo se aprueba un cambio malo. Mitigación: ancla de oráculo + no-auto-promoción + reversión; P6/P7.
- **R5 — Núcleo que crece (deja de ser mínimo).** La tentación de meter cosas al núcleo. Mitigación: criterio de frontera (§3, "si el enjambre puede generarlo, va fuera"); revisar la frontera en cada release.
- **R6 — Sobre-ingeniería (◆ el OS literal).** Mitigación: quedarse en disciplina de módulos + sandbox; no construir un OS real.
- **R7 — Límites del plan al orquestar.** Rate limits/cuotas. Mitigación: backoff + cola; revisar términos de uso vigentes.

---

## 16. Glosario

- **Kaname** (要) — el remache del abanico; aquí, el núcleo inmutable del que todo depende.
- **Núcleo / espacio de skills** — las dos zonas: lo sagrado e inmutable / lo mutable y aislado.
- **Contrato** — la frontera dura: carga, validación (CSV), aislamiento y mediación.
- **Syscalls (KernelSyscalls)** — la superficie estrecha y única por la que una skill pide al núcleo.
- **Enjambre** — las instancias de Claude Code orquestadas por el núcleo (constructores + verificadores).
- **Ancla de oráculo** — la prueba dura con oráculo como árbitro final, inmune al número de workers.
- **Evolución del núcleo** — el proceso deliberado y versionado por el que cambia lo inmutable.

---

*Fin del dossier v1. El Kaname es la pieza que vuelve estructural la robustez: un núcleo mínimo, congelado y verificado, separado por una frontera dura de todo lo que crece y muta. Hace posible soltar un enjambre de constructores sin riesgo —porque lo peor que pueden producir es una skill que el oráculo rechaza— y libera al operador de la revisión rutinaria sin caer en el juez-y-parte. Es el suelo firme sobre el que el resto del dojo puede crecer, mutar y jugar sin miedo a romperse.*
