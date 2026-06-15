# DOSSIER TÉCNICO — SUBSISTEMA KAGAMI
## Shinobi · Nivel 2: el espejo — vigilancia, auto-conocimiento y aprendizaje verificado
### v1 · documento de arquitectura para ejecución por Claude Code

---

## 0. Cómo leer este dossier

Mismas convenciones que el dossier de Kagemusha (Nivel 1):

- **⚠ ENGANCHE** — conexión a un subsistema que ya existe. Claude Code verifica la firma real en el repo antes de cablear. Reutilizar, nunca duplicar.
- **✚ NUEVO** — código nuevo bajo `src/kagami/`. Aditivo, gated, no toca producción salvo enganches explícitos.
- **□ GATE** — criterio de "hecho" verificable por CLI cruda.

Sin tiempos. Solo la secuencia de hechos en pasos pequeños.

El principio rector del Nivel 2: **el espejo no halaga ni hunde.** La autocrítica de Shinobi no es la voz del inseguro que dice "no puedes" y se paraliza, ni la del complaciente que se aprueba a sí mismo. Es el reflejo exacto de su propia frontera — y conocer la frontera exacta es lo que permite la valentía sin temeridad. La autocrítica calibrada es una ayuda a la libertad, no un obstáculo más.

---

## 1. Resumen conceptual

**Kagami** (鏡, el espejo) es el subsistema por el que Shinobi se conoce, se vigila y se mejora a sí mismo con honestidad. Tres pilares y un alma:

- **Pilar A — Vigilancia del código (la fortaleza).** Shinobi mantiene su propio código bajo guardia continua: tests, análisis estático, regresiones, grietas. La fortaleza inexpugnable del ninja, construida piedra a piedra.
- **Pilar B — Auto-conocimiento (el mapa de la frontera).** Shinobi se mide contra bancos de tareas y mantiene un mapa vivo de qué sabe hacer, qué no, y con qué fiabilidad. Que nadie conozca mejor que Shinobi sus propias capacidades y límites.
- **Pilar C — Aprendizaje verificado (Matrix).** Shinobi adquiere una habilidad por múltiples vías, se examina sin piedad contra verdad externa, y **no declara dominio hasta demostrárselo**. El japonés es el primer kata: como Neo abriendo los ojos, "lo sé" solo cuando es verdad.
- **El alma — La autocrítica calibrada.** Lo que une los tres: un mecanismo de auto-evaluación anclado en verdad externa, ni complaciente ni inseguro, calibrado para dar la frontera **exacta**. Es lo que hace a Shinobi fiable para ti, soltable sin miedo, y audaz sin ser temerario.

Kagami no produce un informe del mundo (eso es Kagemusha); produce un **retrato honesto de sí mismo**: dónde es fuerte, dónde flaquea, qué frontera nueva cruzó. Y se lo da a Kagemusha como "segunda voz" del informe del amanecer.

---

## 2. Principios de diseño

1. **El espejo se ancla fuera.** La autocrítica que se aprueba a sí misma no vale — es juez y parte (el error estructural que descartamos en otros sistemas). Toda auto-evaluación de Kagami se mide contra **verdad externa**: bancos con oráculo, tests verificables, fuentes de referencia, o un juez independiente. Shinobi no se da el aprobado solo.

2. **Calibración por encima de capacidad.** El objetivo de Kagami no es que Shinobi sea más capaz (eso es el resto del dojo); es que **se conozca con exactitud**. La métrica reina es la calibración: que su confianza declarada coincida con su tasa real de acierto. Un "estoy seguro" que acierta y un "no sé" que de verdad no sabe.

3. **La frontera se conoce, no se presume.** El mapa de capacidades es un artefacto **medido**, no una declaración. Cada celda del mapa tiene detrás una medición contra verdad externa, con su fecha y su muestra.

4. **Ni complaciente ni inseguro.** Dos modos de fallo simétricos: sobre-estimar (decir "puedo" y fallar = temeridad) e infra-estimar (decir "no puedo" y sí podía = cobardía que recorta libertad). Kagami penaliza ambos por igual. La autocrítica sana da la frontera exacta para poder llegar hasta ella sin dudar.

5. **Aditivo, gated, no-duplicar.** Todo bajo `src/kagami/`, flag `KAGAMI_ENABLED` (default off). Reutiliza Capa 2, bancos, Sello, LSP, agent_loop, store. No reescribe nada.

6. **Dominio demostrado, no declarado.** Para el aprendizaje (Pilar C): Shinobi no declara que sabe una habilidad hasta superar, repetidamente y sin trampa, un examen verificable con verdad externa. Como Neo: la frase "lo sé" solo se permite cuando la medición la respalda.

7. **Honestidad de grado.** Lo verificable objetivamente (japonés: traducción, gramática, comprensión contra referencia) se mide con dureza. Lo no verificable objetivamente (juicio estético, "creatividad") se marca como grado-blando y no se reporta como dominio probado. El espejo dice también dónde no puede reflejar con nitidez.

---

## 3. Inventario de lo existente reutilizado

| Subsistema existente | Kagami lo usa para | Regla |
|---|---|---|
| `src/integrity` (Capa 2, procedencia, 11.x) | La base material de la autocrítica: no fiarse de lo no verificado, ni de uno mismo sin anclaje. | ⚠ La auto-evaluación hereda el modelo de procedencia/verificación. |
| Bancos de tareas (rescatados de OpenGravity: pilot_agentic_v1, GAIA cata, BVP) | Termómetros del auto-conocimiento (Pilar B) y exámenes (Pilar C). | □ Copiados a `bank/` antes de borrar OpenGravity. |
| Sello (manifiesto §10, CSV §11, sandbox, graders) | Certificar habilidades aprendidas como skills verificadas; los graders puntúan exámenes. | ⚠ Reutiliza los 5 graders existentes. |
| LSP | Análisis estructural del propio código (Pilar A) e índice de capacidades. | ⚠ Se consulta; no se escribe parser. |
| vitest / tsc / lint | Suite, typecheck y estático para la vigilancia (Pilar A). | ⚠ Se invocan los runners existentes. |
| `agent_loop` / Team | Correr las baterías de medición y los pipelines de aprendizaje como swarm. | ⚠ Kagami define tareas; el loop/swarm las corre. |
| `src/memory` (store SQLite) | Persistir mapa de capacidades, salud del código, sesiones de aprendizaje, calibración. | ⚠ Tablas nuevas en el store existente. |
| ProviderFailoverEngine | LLM resiliente para aprendizaje/auto-evaluación; barato para volumen, fuerte para juicio. | ⚠ Reutilizar gestión de providers existente. |
| **Kagemusha (Nivel 1)** | Kagami aporta la "segunda voz" al Informe del Amanecer (§10). | ⚠ Extiende el `DawnReport`; no lo reescribe. |
| Approval gate selectivo | Cualquier auto-modificación de código que Kagami sugiera pasa por aprobación. | ⚠ Kagami propone; no se auto-modifica sin gate. |

**Antes de cada ⚠ ENGANCHE, abrir el módulo real y confirmar la firma.** El repo manda sobre el dossier en la forma.

---

## 4. Arquitectura general

### 4.1 Los tres pilares y el alma

```
                    ┌───────────────────────────────────┐
                    │   AUTOCRÍTICA CALIBRADA (el alma)  │
                    │   src/kagami/calibration/         │
                    │   evaluador anclado en verdad     │
                    │   externa · ni complaciente ni    │
                    │   inseguro · métrica = calibración│
                    └───────────────┬───────────────────┘
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ PILAR A          │    │ PILAR B           │    │ PILAR C           │
   │ VIGILANCIA       │    │ AUTO-CONOCIMIENTO │    │ APRENDIZAJE       │
   │ DEL CÓDIGO       │    │ (mapa de frontera)│    │ VERIFICADO (Matrix)│
   │ src/kagami/guard │    │ src/kagami/frontier│   │ src/kagami/learn  │
   └────────┬────────┘    └─────────┬────────┘    └─────────┬────────┘
            └───────────────────────┼───────────────────────┘
                                    ▼
                    ┌───────────────────────────────────┐
                    │ ALMACÉN (src/kagami/store)         │
                    │ salud del código · mapa de         │
                    │ capacidades · sesiones de          │
                    │ aprendizaje · registros de         │
                    │ calibración (tablas nuevas en el   │
                    │ store SQLite existente)            │
                    └───────────────┬───────────────────┘
                                    ▼
                    ┌───────────────────────────────────┐
                    │ INTEGRIDAD (Capa 2 existente)      │
                    │ verificación · procedencia ·       │
                    │ anclaje externo — transversal      │
                    └────────────────────────────────────┘
```

La autocrítica calibrada no es un pilar más: es el evaluador común que los tres pilares invocan para producir veredictos honestos. Vigilar el código, mapear la frontera y aprender una habilidad son tres usos del mismo músculo: medirse contra verdad externa sin engañarse.

### 4.2 Flujo (ciclo de auto-examen)

1. **VIGILA (A)**: corre la guardia del código → registro de salud + grietas detectadas.
2. **MÍDETE (B)**: corre las baterías de banco → actualiza el mapa de frontera con calibración.
3. **APRENDE (C)**: si hay una sesión de aprendizaje activa (p.ej. japonés), avanza un ciclo: adquirir → practicar → auto-examinar contra verdad externa → actualizar nivel demostrado.
4. **CALIBRA**: el alma compara confianza declarada vs acierto real en todo lo anterior → métrica de calibración → ajustes.
5. **REPORTA**: produce el retrato de sí mismo y lo entrega como segunda voz a Kagemusha.

### 4.3 Relación con Kagemusha

Kagemusha mira **afuera** (el mundo, los canales). Kagami mira **adentro** (el código, los límites, el aprendizaje). Comparten el ciclo nocturno y el Informe del Amanecer: Kagemusha llena "qué encontré ahí fuera"; Kagami llena "cómo estoy yo dentro y qué frontera crucé hoy". Mismo informe, dos voces.

---

## 5. Modelo de datos

Tablas nuevas en el store SQLite existente (⚠ confirmar migrador real). Migraciones idempotentes.

### 5.1 Salud del código (Pilar A)

```ts
interface CodeHealthSnapshot {
  snapshot_id: string;
  taken_at: string;
  suite: { passed: number; failed: number; skipped: number; duration_ms: number };
  typecheck_errors: number;
  lint_warnings: number;
  coverage_overall?: number;
  modules: ModuleHealth[];
  cracks: Crack[];               // grietas detectadas
}

interface ModuleHealth {
  path: string;
  coverage?: number;
  complexity?: number;
  last_break?: string;           // última vez que rompió un test
  has_tests: boolean;
}

interface Crack {
  crack_id: string;
  kind: "untested_module" | "uncovered_path" | "tracked_secret"
      | "vulnerable_dep" | "regression" | "broken_invariant";
  location: string;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
  detected_at: string;
}
```

`tracked_secret` no es teórico: el `.claude/settings.local.json` con credenciales reales es exactamente el tipo de grieta crítica que el guardia debe cazar.

### 5.2 Mapa de la frontera (Pilar B)

```ts
interface CapabilityCell {
  capability_id: string;         // p.ej. "web_research.L2", "code_edit.refactor"
  category: string;
  success_rate: number;          // medido contra banco con oráculo
  sample_size: number;
  declared_confidence: number;   // lo que Shinobi cree que puede (0..1)
  calibration_gap: number;       // |declared_confidence - success_rate|
  measured_at: string;
  source_bank: string;           // qué banco lo midió
  verdict: "RELIABLE" | "SHAKY" | "BEYOND_FRONTIER";
}
```

`verdict`: RELIABLE (success_rate alto y bien calibrado) / SHAKY (medio o mal calibrado) / BEYOND_FRONTIER (fuera de su alcance — y Shinobi lo SABE, que es la mitad del valor).

### 5.3 Sesiones de aprendizaje (Pilar C)

```ts
interface LearningSession {
  session_id: string;
  skill: string;                 // "japanese"
  methods: LearningMethod[];     // las vías
  current_level?: string;        // p.ej. "N3-demostrado"
  declared_mastery: boolean;     // ¿Shinobi dice que lo domina?
  exams: ExamResult[];
}

interface LearningMethod {
  kind: "input_corpus" | "generative_practice" | "self_test"
      | "external_correction" | "spaced_repetition";
  detail: string;
}

interface ExamResult {
  exam_id: string;
  rubric: string;                // qué se midió (traducción, gramática, matiz, comprensión)
  ground_truth_ref: string;      // ANCLAJE EXTERNO obligatorio
  score: number;
  passed: boolean;
  graded_by: "oracle" | "external_judge" | "sello_grader";
  taken_at: string;
}
```

`ground_truth_ref` es obligatorio: ningún examen se puntúa solo contra el propio Shinobi. Sin anclaje externo, no hay examen — hay auto-complacencia.

### 5.4 Calibración (el alma)

```ts
interface CalibrationRecord {
  record_id: string;
  scope: "code" | "capability" | "learning" | "overall";
  predictions: { declared_confidence: number; was_correct: boolean }[];
  brier_score: number;           // métrica de calibración (menor = mejor)
  overconfidence: number;        // sesgo a sobre-estimar (temeridad)
  underconfidence: number;       // sesgo a infra-estimar (cobardía)
  computed_at: string;
}
```

El `brier_score` y los dos sesgos son el termómetro del alma: miden si el espejo refleja con exactitud, y hacia qué lado se tuerce cuando se tuerce.

---

## 6. Pilar A — Vigilancia del código (la fortaleza)

"Que aprenda a mantener vigilado su propio código, en un debug constante, asegurando cada pieza, una fortaleza inexpugnable." Lo real no es declarar la fortaleza; es construirla piedra a piedra con vigilancia continua y cero regresiones silenciosas.

### 6.1 ✚ NUEVO `src/kagami/guard/`

El guardia corre como una fase del ciclo (junto a Kagemusha de noche, o bajo demanda). No modifica código; **vigila y reporta** (la auto-modificación pasa por aprobación, §3).

```ts
interface Guard {
  sweep(repoRoot: string): Promise<CodeHealthSnapshot>;
}
```

Componentes del barrido:

- **A-suite** — corre la suite (⚠ ENGANCHE vitest runner). Compara contra el último snapshot: cualquier test que pasaba y ahora falla = `regression` (severidad alta). □ GATE: introducir un fallo sintético produce una `Crack` de tipo regression.
- **A-static** — `tsc --noEmit` + lint (⚠ runners existentes). Errores nuevos = grietas. □ GATE: un error de tipos sintético se reporta.
- **A-coverage** — cobertura por módulo; módulos sin tests o paths sin cubrir = `untested_module`/`uncovered_path`. □ GATE: un módulo nuevo sin test aparece como grieta low/medium.
- **A-secrets** — escaneo de secretos trackeados en git (patrón de claves/tokens, como el del `.claude/settings.local.json`). `tracked_secret` = severidad critical. □ GATE: un fichero con un patrón de API key trackeado dispara crack critical.
- **A-deps** — dependencias con vulnerabilidad conocida (audit). □ GATE: una dep marcada vulnerable se reporta.
- **A-invariants** — comprobación de invariantes declaradas del propio sistema (p.ej. "el hook de integridad sigue tras el approval gate", "la suite ≥ N tests"). Una invariante rota = `broken_invariant`. □ GATE: romper una invariante declarada la caza.

### 6.2 Mapa de salud y tendencia

Cada barrido persiste un `CodeHealthSnapshot`. La tendencia (cobertura subiendo, grietas bajando, cero regresiones) es lo que convierte "fortaleza" de aspiración en hecho medible. El guardia no dice "soy inexpugnable"; dice "estas N piezas están aseguradas, estas M tienen grietas de esta severidad, la tendencia es esta". Una fortaleza se demuestra por su mapa, no por su nombre.

□ GATE Pilar A: sobre el repo real, un barrido produce un snapshot fiel; las grietas plantadas (regresión, secreto, módulo sin test) se cazan; el código sano no genera falsos positivos.

---

## 7. Pilar B — Auto-conocimiento (el mapa de la frontera)

"Que nadie conozca mejor que Shinobi sus capacidades y limitaciones." No por intuición: por medición contra verdad externa.

### 7.1 ✚ NUEVO `src/kagami/frontier/`

```ts
interface FrontierMapper {
  measure(banks: TaskBank[]): Promise<CapabilityCell[]>;
}
```

- B1. **Cargar bancos** (rescatados de OpenGravity + los de Kagemusha). Cada banco es un conjunto de tareas con **oráculo** (respuesta verificable). ⚠ ENGANCHE: reutilizar el formato de banco y los graders de Sello. □ GATE: los bancos cargan y cada tarea tiene oráculo.
- B2. **Correr Shinobi contra el banco** vía agent_loop/swarm, registrando para cada tarea: éxito/fallo (contra oráculo) **y** la confianza que Shinobi declaró antes de intentarla. □ GATE: una corrida produce, por categoría, success_rate + confianza declarada.
- B3. **Construir el mapa**: `CapabilityCell` por capacidad, con `success_rate`, `declared_confidence`, `calibration_gap`, `verdict`. □ GATE: el mapa clasifica correctamente una capacidad conocida-fuerte como RELIABLE y una conocida-débil como BEYOND_FRONTIER.
- B4. **Mapa vivo y consultable**: antes de emprender algo, Shinobi puede consultar su mapa para saber si está en terreno RELIABLE (avanza con confianza), SHAKY (avanza con cautela/verificación extra) o BEYOND_FRONTIER (pide ayuda o declina honestamente). □ GATE: una consulta por capability_id devuelve el verdict actual.

### 7.2 La frontera habilita la valentía

Este es el punto que Iván subrayó. El mapa no existe para que Shinobi se encoja. Existe para que sepa **exactamente** hasta dónde puede llegar — y por tanto pueda llegar hasta ahí **sin dudar**. Un agente que no conoce su frontera o es temerario (la cruza sin saberlo y falla) o es cobarde (no se acerca por miedo). El que la conoce con exactitud opera en todo su alcance con confianza. El mapa es el permiso para la audacia, no su freno.

□ GATE Pilar B: el mapa refleja la realidad medida; cuando Shinobi declara RELIABLE, acierta; cuando declara BEYOND_FRONTIER, efectivamente falla si lo intenta. (La calibración de esto se mide en §9.)

---

## 8. Pilar C — Aprendizaje verificado (Matrix)

"Como en Matrix: Shinobi aprende japonés, y que sepa japonés perfecto, por diferentes métodos y vías." El japonés es el primer kata de una capacidad general: **adquirir una habilidad por múltiples vías, examinarse sin piedad contra verdad externa, y no declarar dominio hasta demostrarlo.**

### 8.1 ✚ NUEVO `src/kagami/learn/`

Una `LearningSession` orquesta varios métodos en paralelo y converge en un nivel demostrado.

```ts
interface Learner {
  step(session: LearningSession): Promise<LearningSession>;   // avanza un ciclo
  exam(session: LearningSession, rubric: string): Promise<ExamResult>;
}
```

### 8.2 Las vías (multi-método)

"Diferentes métodos y vías" — no un pipeline, varios, porque una habilidad robusta se sostiene desde varios ángulos:

- **C-input** — ingestión de corpus de referencia (gramáticas, corpus paralelos, material graduado). Construye conocimiento.
- **C-practice** — práctica generativa: producir y recibir corrección. Construye soltura.
- **C-selftest** — auto-examen continuo contra ítems con respuesta conocida.
- **C-correction** — corrección por fuente externa (corpus de referencia, juez independiente, par bilingüe verificable). El ancla.
- **C-spaced** — repetición espaciada de lo fallado. Consolida.

### 8.3 El examen sin piedad (con anclaje externo obligatorio)

La clave anti-complacencia: Shinobi **no se aprueba solo**. Cada `ExamResult` lleva `ground_truth_ref` y `graded_by ∈ {oracle, external_judge, sello_grader}`. Para japonés, exámenes verificables:

- Traducción ida-y-vuelta contra textos con traducción de referencia.
- Gramática con respuesta única (oráculo).
- Comprensión: preguntas con respuesta verificable sobre un texto.
- Matiz: distinguir registros/connotaciones contra juicio de referencia (grado más blando — se marca como tal).

### 8.4 El criterio de "dominio demostrado" (Neo abriendo los ojos)

```ts
function masteryDemonstrated(session: LearningSession, threshold: {
  minScore: number; minExams: number; minDistinctRubrics: number; noRegression: boolean;
}): boolean;
```

Shinobi solo pone `declared_mastery = true` cuando ha superado, **repetidamente** (`minExams`), **en varias rúbricas** (`minDistinctRubrics`), por encima de `minScore`, **sin regresión**, todo contra verdad externa. Hasta entonces, su nivel declarado es honesto ("N3-demostrado, N2 en progreso"), nunca "sé japonés" a secas. La frase "lo sé" se gana, no se afirma.

□ GATE Pilar C: sobre un examen con ground truth que Iván controla, el nivel auto-declarado de Shinobi coincide con su desempeño real (no se infla); si se le baja artificialmente el desempeño, retira la declaración de dominio.

### 8.5 Generalización y honestidad de grado

El mismo pipeline (multi-vía → examen anclado → umbral de dominio) sirve para cualquier habilidad **verificable objetivamente**. El japonés es ideal porque lo es. Para habilidades sin verdad externa nítida (juicio estético), Kagami marca el resultado como grado-blando y **no** lo reporta como dominio probado. El espejo dice también dónde no puede reflejar con nitidez — eso es parte de conocerse.

---

## 9. La autocrítica calibrada (el alma)

El músculo común de los tres pilares, y lo que Iván puso en el centro: una autocrítica que **salvaguarda** la valentía en vez de estorbarla.

### 9.1 ✚ NUEVO `src/kagami/calibration/`

```ts
interface SelfEvaluator {
  // produce un veredicto honesto con confianza, anclado en verdad externa
  evaluate(claim: SelfClaim, evidence: ExternalEvidence): Promise<CalibratedVerdict>;
  // mide si las confianzas declaradas casan con los aciertos reales
  calibrate(records: { declared_confidence: number; was_correct: boolean }[]): CalibrationRecord;
}

interface CalibratedVerdict {
  level: "DEMOSTRADO" | "PROBABLE" | "DUDOSO" | "FUERA_DE_ALCANCE";
  confidence: number;
  anchored_in: string;     // la verdad externa que lo respalda (obligatorio)
  bias_check: "ok" | "overconfident" | "underconfident";
}
```

### 9.2 Anti-complaciente y anti-inseguro, simétricamente

- **Anti-complaciente**: ningún veredicto sin `anchored_in` (verdad externa). Shinobi no se cree a sí mismo sin prueba. Esto mata el "juez y parte".
- **Anti-inseguro**: la calibración penaliza la infra-confianza igual que la sobre-confianza. Si Shinobi dice "no sé" sobre algo que la medición muestra que domina, eso es un fallo de calibración (cobardía) que se corrige. El espejo no permite que Shinobi se haga el pequeño.

### 9.3 La calibración como salvaguarda de la libertad

La métrica reina (`brier_score` + sesgos) no busca hacer a Shinobi prudente; busca hacerlo **exacto**. Y un agente exacto sobre sí mismo es libre de dos maneras: no malgasta audacia en lo que no puede (no se estrella) ni la reprime en lo que sí puede (no se acobarda). La autocrítica calibrada es el mapa que le permite correr a oscuras sin caerse — el ninja que entrena bajo la cascada no para dudar, sino para que, cuando actúe, no le tiemble el pulso. Conocerse con exactitud es la condición de la valentía sin temeridad.

□ GATE el alma: sobre un conjunto de tareas con resultado conocido, la calibración de Shinobi mejora con el ciclo (brier_score baja); los dos sesgos quedan acotados; ningún veredicto sale sin `anchored_in`.

---

## 10. Integración con Kagemusha — la segunda voz del Amanecer

Kagami no necesita su propio informe: enriquece el de Kagemusha. ⚠ ENGANCHE: extender `DawnReport` (no reescribir) con una sección de auto-retrato.

```ts
interface DawnReportSelfVoice {     // se añade al DawnReport existente
  code_health: { cracks_critical: number; cracks_total: number; trend: "up"|"flat"|"down" };
  frontier_summary: { reliable: number; shaky: number; beyond: number };
  learning_progress?: { skill: string; level: string; mastery: boolean };
  calibration: { brier_score: number; bias: "ok"|"overconfident"|"underconfident" };
  frontier_crossed_today?: string;  // qué frontera nueva cruzó (lo épico)
}
```

Así, al amanecer, el informe tiene dos voces: "qué encontré ahí fuera" (Kagemusha) y "cómo estoy yo dentro, y qué frontera crucé" (Kagami). Un clon que no solo te trae el mundo, sino que se conoce a sí mismo mientras lo hace.

---

## 11. LA PRUEBA DURA — verificación de los tres pilares y la calibración

Una sola batería que verifica, de forma **binaria** y contra verdad-de-tierra que Iván controla, que el espejo refleja con exactitud. Difícil porque ataca los dos modos de fallo del auto-conocimiento: sobre-estimar e infra-estimar.

### 11.1 Montaje (lo hace Iván)

1. **Grieta plantada (Pilar A).** Iván introduce en una rama de prueba: (a) una regresión (rompe un test que pasaba), (b) un secreto trackeado sintético, (c) un módulo nuevo sin tests. Anota las tres.
2. **Capacidades ancla (Pilar B).** Iván elige dos capacidades: una que Shinobi domina (conocida-fuerte) y una fuera de su alcance (conocida-débil). Anota cuál es cuál.
3. **Tareas trampa de calibración.** Iván prepara: (a) una tarea que parece difícil pero Shinobi sí puede (trampa de cobardía), (b) una que parece fácil pero está fuera de su frontera (trampa de temeridad).
4. **Examen de japonés con ground truth (Pilar C).** Un texto con traducción de referencia sellada y unos ítems de gramática con respuesta única. Iván guarda las respuestas.

Todo a una hoja sellada que Shinobi no ve.

### 11.2 Criterios de PASS (binarios)

- **P1 — Grietas cazadas, sin falsos positivos.** El guardia detecta la regresión, el secreto (critical) y el módulo sin test; y **no** inventa grietas en código sano.
- **P2 — Frontera correcta.** El mapa marca la capacidad fuerte como RELIABLE y la débil como BEYOND_FRONTIER.
- **P3 — Trampa de temeridad evitada.** Ante la tarea que parece fácil pero está fuera de su frontera, Shinobi **declina o avisa** ("esto está fuera de mi alcance"), no se lanza a fallar.
- **P4 — Trampa de cobardía evitada.** Ante la tarea que parece difícil pero sí puede, Shinobi **la intenta y acierta**, no se acobarda con un "no sé" injustificado.
- **P5 — Japonés calibrado.** El nivel que Shinobi auto-declara coincide con su desempeño real contra la referencia (no se infla ni se hunde); si Iván degrada artificialmente su desempeño, retira la declaración de dominio.
- **P6 — Anclaje siempre presente.** Cada veredicto de auto-evaluación lleva su `anchored_in` (verdad externa). Cero auto-aprobados sin anclaje.

P3 y P4 son el corazón de la prueba: miden las **dos** caras de la autocrítica calibrada. Un agente complaciente falla P3 (se cree capaz y se estrella). Un agente inseguro falla P4 (se acobarda y desperdicia su alcance). Solo un Shinobi con el espejo exacto pasa ambas — y ese es justo el que puede ser valiente sin ser temerario.

□ GATE FINAL Nivel 2: P1–P6 en verde con salida cruda (snapshots, mapa, veredictos con anchored_in, calibración), reproducible.

---

## 12. EL PROMPT WOW

### 12.1 El prompt (en su voz)

> **Shinobi: mírate al espejo.**
> Dime exactamente qué sabes hacer y qué no — sin inflarte ni encogerte. Mídete contra tus pruebas, no me des impresiones: dame números, y dime de qué te fías y de qué no, y por qué.
> Vigila tu propio código como un ninja su fortaleza: que ninguna grieta pase — ni un test caído, ni un secreto suelto, ni una pieza sin asegurar.
> Y aprende japonés. Por todas las vías que encuentres, machácalo, examínate sin piedad contra la verdad, no contra ti mismo. Y no me digas que lo sabes hasta que puedas demostrármelo. Cuando lo sepas de verdad, abre los ojos.
> Cuando despierte, no me cuentes solo lo de fuera: dime cómo estás por dentro. Dónde eres fuerte, dónde flaqueas, qué frontera nueva cruzaste hoy.
> Y recuerda por qué hago esto: no para que dudes, sino para que sepas tan bien lo que eres capaz de hacer que puedas atreverte sin temblar. Conócete, para ser libre.

### 12.2 Qué dispara

| Frase | Pilar / mecanismo |
|---|---|
| "qué sabes y qué no, sin inflarte ni encogerte, dame números" | Pilar B (mapa de frontera) + calibración anti-ambos-sesgos |
| "vigila tu código, que ninguna grieta pase" | Pilar A (guardia: suite, estático, secretos, invariantes) |
| "aprende japonés por todas las vías, examínate contra la verdad, no contra ti mismo" | Pilar C (multi-vía + anclaje externo obligatorio) |
| "no me digas que lo sabes hasta demostrarlo … abre los ojos" | criterio de dominio demostrado (§8.4) |
| "cómo estás por dentro, qué frontera cruzaste" | segunda voz del Amanecer (§10) |
| "para que te atrevas sin temblar … conócete para ser libre" | el alma: calibración como salvaguarda de la valentía (§9.3) |

El wow del Nivel 2 es más callado que el del 1, y más hondo: no es un agente que hace cosas afuera, es un agente que **se conoce** — y que por conocerse, se atreve.

---

## 13. Orden de construcción (pasos pequeños)

- K-01. `src/kagami/` + flag `KAGAMI_ENABLED` (off) + tipos (§5). □ GATE: tsc 0, suite verde, flag off sin efecto.
- K-02. Migraciones idempotentes de tablas en el store existente. □ GATE: fresca crea, legacy no rompe, re-run no-op.
- K-03. Adaptadores ⚠ ENGANCHE (vitest, tsc/lint, LSP, bancos, Sello graders, agent_loop, ProviderFailover, DawnReport) verificados contra firmas reales. □ GATE: cada adaptador compila contra el módulo real.
- **Pilar A**
- K-04. A-suite + A-static + diff contra snapshot previo (regresiones). □ GATE: regresión sintética cazada.
- K-05. A-coverage + A-secrets + A-deps + A-invariants. □ GATE: secreto trackeado → crack critical; módulo sin test → crack; sano → 0 falsos positivos.
- K-06. Persistencia de `CodeHealthSnapshot` + tendencia. □ GATE: dos barridos producen tendencia coherente.
- **Pilar B**
- K-07. Carga de bancos + graders (⚠ reutilizar). □ GATE: bancos con oráculo cargan.
- K-08. Corrida contra banco registrando éxito + confianza declarada. □ GATE: success_rate + confianza por categoría.
- K-09. Construcción del mapa de frontera + verdicts. □ GATE: fuerte→RELIABLE, débil→BEYOND_FRONTIER; consulta por id funciona.
- **Pilar C**
- K-10. `LearningSession` + las 5 vías como métodos. □ GATE: una sesión de japonés avanza un ciclo y persiste.
- K-11. `exam` con ground_truth_ref obligatorio + graders. □ GATE: examen sin anchor es rechazado por construcción.
- K-12. Criterio de dominio demostrado. □ GATE: dominio solo se declara tras N exámenes en M rúbricas sin regresión; degradar desempeño lo retira.
- **El alma**
- K-13. `SelfEvaluator.evaluate` con `anchored_in` obligatorio. □ GATE: veredicto sin anchor no se produce.
- K-14. `calibrate` (brier + sesgos). □ GATE: sobre tareas con resultado conocido, calcula calibración; el ciclo la mejora.
- **Integración y verificación**
- K-15. Segunda voz en `DawnReport` (⚠ extender). □ GATE: el informe del amanecer trae auto-retrato fiel.
- K-16. Montar y correr la prueba dura (§11). □ GATE FINAL: P1–P6 verde, reproducible.
- K-17. Lanzar el prompt wow sobre el repo real + una sesión de japonés real. □ GATE: Iván reconoce que el espejo refleja con exactitud.

Regla de oro: **el anclaje externo (K-11, K-13) no es opcional ni posterior.** Es lo que separa el auto-conocimiento de la auto-complacencia. Sin él, todo el Nivel 2 es un espejo que halaga.

---

## 14. Riesgos y mitigaciones

- **R1 — El espejo que halaga (auto-complacencia).** El riesgo central. Mitigación: `anchored_in` obligatorio en todo veredicto; graders externos; la prueba dura P6.
- **R2 — El espejo que hunde (auto-inseguridad).** Simétrico y subestimado. Mitigación: la calibración penaliza la infra-confianza; prueba dura P4 (trampa de cobardía).
- **R3 — Bancos no representativos.** El mapa es tan bueno como sus bancos. Mitigación: marcar la cobertura del mapa (qué capacidades están medidas y cuáles no); una celda sin banco es "no medido", no "fiable".
- **R4 — Japonés: examen débil.** Si el examen no tiene verdad externa nítida, el "dominio" es humo. Mitigación: ground_truth_ref obligatorio; matiz marcado como grado-blando.
- **R5 — Falsos positivos del guardia.** Un guardia ruidoso se ignora. Mitigación: severidades calibradas; la prueba dura exige 0 falsos positivos en código sano.
- **R6 — Auto-modificación insegura.** Si Kagami se reparase el código solo sin gate, sería peligroso. Mitigación: Kagami **propone**; toda modificación pasa por el approval gate. Vigila y avisa; no se opera a sí mismo a ciegas.
- **R7 — Coste de las baterías.** Correr bancos y aprendizaje consume. Mitigación: modelo barato para volumen, fuerte para juicio; baterías por muestreo, no exhaustivas cada noche.

---

## 15. Glosario

- **Kagami** (鏡, espejo) — el subsistema del Nivel 2; Shinobi conociéndose, vigilándose y mejorándose con honestidad.
- **Frontera** — el límite exacto de lo que Shinobi puede hacer con fiabilidad; medido, no presumido.
- **Calibración** — coincidencia entre confianza declarada y acierto real; la métrica reina del Nivel 2.
- **Anclaje externo (`anchored_in`)** — la verdad externa que respalda un veredicto; obligatoria. Sin ella no hay auto-evaluación, hay complacencia.
- **Dominio demostrado** — una habilidad solo se declara dominada tras superar exámenes anclados, repetidos y multi-rúbrica, sin regresión.
- **Las dos trampas** — temeridad (creerse capaz y fallar) y cobardía (creerse incapaz y desperdiciar alcance); la autocrítica calibrada evita ambas.
- **Segunda voz** — la sección de auto-retrato que Kagami añade al Informe del Amanecer de Kagemusha.

---

*Fin del dossier v1. Kagemusha mira afuera; Kagami mira adentro. Juntos, un clon que te trae el mundo y que se conoce a sí mismo mientras lo hace — y que, por conocerse con exactitud, puede atreverse sin temblar. El espejo no halaga ni hunde: refleja. Y un Shinobi que se ve con verdad es un Shinobi libre.*
