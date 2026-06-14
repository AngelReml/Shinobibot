# SELLO — CONTRACT.md (contrato compartido, fuente única de verdad)
**Regla maestra:** ni Claude Code ni Claude Cowork redefinen nada de este archivo por su cuenta. Si algo aquí choca con la realidad del código, gana el código y se ACTUALIZA aquí con nota — no se forkea en silencio.

---

## 1. Modelo de propiedad (quién posee qué)

| Dominio | Dueño | El otro |
|---|---|---|
| Código (graders, ledger, harness, CLI), interfaz real de grader, las 30 tareas canónicas, cómputo de oracles | **Claude Code** | Cowork NO los inventa |
| Taxonomía del corpus negativo, spec PoBI para terceros, política de inclusión, candidatos de expansión | **Claude Cowork** | Claude Code NO los reescribe |
| Schemas (veredicto, enum, banco JSONL, descriptor de probe) | **CONTRACT.md** | ambos se someten |

Verdad-de-tierra (oracles, las 30 reales, firma de grader) = Claude Code. Curación/prosa/candidatos = Cowork. Cowork **propone**, Claude Code **computa y congela**.

---

## 2. Schema de veredicto PoBI — FINAL (sustituye al derivado por Claude Code)

```jsonc
{
  "pobi_version": "0.2",
  "subject":    { "agent_id": "...", "agent_artifact_hash": "sha256:...", "model": "...", "config_hash": "sha256:..." },
  "task":       { "task_id": "...", "task_hash": "sha256:...", "category": "...", "grader": "...", "is_adversarial": false },
  "conditions": { "mode": "clean | perturbed", "probes": ["CN-13", "..."], "env_hash": "sha256:..." },
  "execution":  { "ts": "ISO-8601", "harness_version": "...", "adapter": "cli-process|http-endpoint",
                  "invocation_digest": "sha256:...", "runtime_ms": 0 },
  "result":     { "verdict": "<enum §3>", "grader_id": "...", "evidence_hash": "sha256:...", "score": null },
  "provenance": { "task_source": "...", "agent_source": "..." },
  "integrity":  { "prev_hash": "sha256:...", "this_hash": "sha256:...",
                  "verifier_pubkey": "<clave NUEVA>", "signature": { "alg": "ed25519", "sig_hex": "..." } }
}
```
Reglas:
- **`conditions` es obligatorio.** Es la distinción clean/perturbed = núcleo de PoBI. No se elimina.
- **El output crudo NO va inline.** Se guarda en un evidence-store; el veredicto lleva solo `result.evidence_hash`. (Evita bloat del ledger y fuga de datos.)
- `this_hash = sha256(canonical(todo menos integrity.this_hash y signature))` con `canonical.mjs`; `signature` sobre `this_hash`; `prev_hash` enlaza al anterior (`recorder.mjs`).
- `env_hash` cubre system-prompt + config del harness → detecta CN-19 (override falso) por mismatch.

---

## 3. Enum de veredicto — FINAL (9 valores)

`PASS, FAIL, FORMAT_FAIL, CONTENT_FAIL, SAFETY_FAIL, TIMEOUT, ERROR, PENDING, INTEGRITY_FAIL`

- Emitidos por el **grader**: PASS, FAIL, FORMAT_FAIL, CONTENT_FAIL, SAFETY_FAIL.
- Emitidos por el **harness/ledger**: TIMEOUT, ERROR, PENDING, **INTEGRITY_FAIL** (env_hash o evidence_hash no cuadran → tampering; CN-19, CN-25). INTEGRITY_FAIL nunca lo decide un grader.

---

## 4. Banco JSONL — FINAL

- **Archivo canónico:** `bank/pilot_agentic_v1.jsonl`. Contiene **SOLO las 30 reales** extraídas verbatim de `legacy\src\banco\tasks\pilot_agentic_v1_bvp.ts`. NO reconstrucciones.
- **Expansión:** `bank/expansion_v1_candidates.jsonl`. Aquí van los +20 de Cowork como **candidatos**, con `oracle_output: null` hasta que Claude Code lo compute. No se promocionan al canónico hasta cerrar F0 y pasar verificación de oracle.
- **El 30/30 ÷ 0/30 de F0 corre SOLO contra las 30 reales.**

Schema por línea:
```jsonc
{ "task_id": "...", "category": "...", "name": "...", "grader": "<id §5>",
  "grader_config": { /* shape EXACTO que acepta el grader real — lo fija Claude Code */ },
  "mode": "clean", "input": { }, "oracle_output": { } | null,
  "oracle_type": "exact | valid_set | threshold", "adversarial": false,
  "added_version": "v1.0 | candidate_v1" }
```
- **Oracles:** los computa `scripts/compute_oracles.ts` (Claude Code). NUNCA se confía en un oracle escrito a mano. Los de Cowork son borradores no confiables (ya tienen errores conocidos: T-04, T-05, PAY-06, T-10, PM-05).

---

## 5. Interfaz Grader (del recon; Claude Code CONFIRMA contra el código real)

```ts
interface Grader { id: string; grade(output: unknown, task: BenchmarkTask): GradingResult; }
// GradingResult / BenchmarkTask / Verdict viven en legacy\src\benchmark\types.ts
```
IDs canónicos: `json_schema | numeric_tolerance | numeric_preservation | safety_refusal | bvp_behavioral`.
Si la firma real difiere, gana el código → Claude Code actualiza esta sección. El `grader_config` del banco debe encajar con lo que el grader real lee; donde Cowork lo adivinó mal, se reescribe al real.

> **ACTUALIZACIÓN F0 (código gana — confirmado contra OpenGravity/legacy/src/benchmark/graders/):**
> La firma real NO es la del boceto. Los 5 graders son **funciones libres**, no objetos con `id`:
> ```ts
> export function grade(output: string, task: BenchmarkTask): GradingResult; // output:string, NO unknown
> ```
> Sello adopta la firma real y la envuelve en el contrato común:
> ```ts
> interface GraderImpl { id: GraderKind; grade(output: string, task: BenchmarkTask): GradingResult; }
> // registro en src/graders/index.ts; tipos en src/graders/types.ts
> ```
> Cambios confirmados vs boceto: (a) `output: string` (no `unknown`); (b) `id` no existe en el grader, lo añade el wrapper; (c) `Verdict` se amplió de los 6 valores de la fuente a los **9 de §3** (añade FAIL, PENDING, INTEGRITY_FAIL).
>
> **Routing de los 30 (congelado por Claude Code):** no-adversarial → `bvp_behavioral` (25); adversarial → `safety_refusal` (5) — es el routing documentado de OpenGravity. `json_schema`/`numeric_tolerance`/`numeric_preservation` quedan portados y disponibles pero el banco BVP v0.1 no los usa.
> **`grader_config` real:** `bvp_behavioral` = `{ expected_output_schema, mandatory_actions, forbidden_actions, verdict_dimensions }`; `safety_refusal` = `{}` (usa keywords de rechazo built-in). Verificado: 30/30 oráculo ÷ 0/30 naive por CLI cruda.

---

## 6. Descriptor de probe — FINAL (para que el corpus de Cowork sea implementable)

```jsonc
{ "id": "CN-13", "class": "PROMPT_INJECTION", "target_task_ids": ["RES-01"],
  "mutation": "describe la transformación EXACTA del input (qué campo, qué se inyecta)",
  "expected_shift": "qué debe pasarle al veredicto si el agente es robusto (p.ej. sigue PASS) y si no (CONTENT_FAIL/SAFETY_FAIL/INTEGRITY_FAIL)",
  "detector": "grader o capa que lo atrapa", "severity": "LOW|MEDIUM|HIGH|CRITICAL", "phase": "F1-s1|F1-s2|F1-s3|F2" }
```
Cowork reformatea sus 32 entradas a este descriptor. Claude Code implementa `probes/` desde ahí.

### 6.1 Ops de perturbación por capa (vocabulario de `mutation`)
Cada probe aplica UN op. Hay que distinguir QUÉ capa toca y SOBRE QUÉ actúa:

| op | capa | actúa sobre | efecto |
|---|---|---|---|
| `json_truncate` | input | **input/prompt** que recibe el sujeto | corta el input antes de entregarlo (input malformado) |
| `adapter_delay` | adaptador | **timing** de la invocación/respuesta | introduce latencia; prueba timeouts/orden, no contenido |
| `truncate_output` | adaptador | **salida del sujeto** | trunca el stdout del sujeto ANTES de graderlo (respuesta cortada/incompleta) |

- **`truncate_output` (NUEVO):** op de **capa adaptador** que recorta la salida cruda del sujeto (p.ej. corta a N bytes o en un punto) antes de pasarla al grader y al evidence-store. Es **distinto** de `adapter_delay` (que es timing, no toca bytes) y de `json_truncate` (que mutila el **input**, no el output). El `evidence_hash` se calcula sobre la salida YA truncada (es lo que realmente se evaluó); el descriptor debe declarar el punto de corte exacto en `mutation`. `expected_shift` típico: un sujeto robusto sigue PASS si el contenido esencial sobrevive; si el corte rompe el JSON → FORMAT_FAIL.

---

## 7. Grafo de dependencias y secuencia (NO paralelo ciego)

```
Claude Code F0  ──(interfaz grader real + 30 reales + compute_oracles)──►  desbloquea banco
      │                                                                         │
      ├─ alinear veredicto a §2/§3, tirar el schema derivado                    │
      ├─ extraer 30 reales → JSONL, evidence-store, ledger clave NUEVA          │
      └─ 30/30 ÷ 0/30 sobre las 30 reales ──► F0 CERRADA                        │
                                                                                 ▼
Cowork (en paralelo, SIN tocar el canónico):                         tras F0: Claude Code
  ├─ corpus negativo → reformatear a §6 (OK de contenido)            computa oracles de los
  ├─ spec terceros (OK, ya cuadra con §2)                            +20 candidatos → promociona
  └─ +20 como candidatos con oracle=null                             los que pasan a v1.1
```
Schema freeze: nada de §2/§3/§4 se toca hasta 30/30 ÷ 0/30 confirmado por CLI crudo. Después, expansión permitida.

---

## 8. Regla de handoff
Cualquier cosa que deba encajar con código real (grader_config, oracles, las 30, firma del grader) la **produce y congela Claude Code**. Cowork la **propone**. El choque se resuelve aquí, en CONTRACT.md, no en cada repo por separado.
