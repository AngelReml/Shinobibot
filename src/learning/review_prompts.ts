/**
 * Fase 2 del bucle de aprendizaje — prompts de background review.
 *
 * Adaptados casi literalmente de hermes-agent (`background_review.py:34-215`),
 * que el mapa marca como "el activo más replicable". Diferencia de diseño:
 * Hermes deja que el fork llame tools (`memory`, `skill_manage`); Shinobi
 * usa una variante de decisión estructurada — el review devuelve JSON y el
 * código despacha por las rutas ya auditadas (`curatedMemory`, `skill_manager`).
 * El resultado de aprendizaje es idéntico y el despacho es determinista.
 */

/** Contrato de salida común a los tres prompts. */
const OUTPUT_CONTRACT = `
OUTPUT FORMAT — respond with ONLY a JSON object. No prose, no code fence:
{
  "memory": [ { "content": "<declarative fact, one sentence>" } ],
  "skills": [ { "context": "<the recurring procedure/technique/fix to capture, with enough detail that a SKILL.md can be written from it>" } ],
  "note": "<one short line summarising what you decided, or 'nothing to save'>"
}
Use an empty array for a dimension when there is nothing worth saving.`;

/**
 * Lista negra — qué NUNCA capturar como skill. Es lo que evita que el
 * agente se auto-degrade con el tiempo (mapa §1.3, pitfall #1).
 */
const SKILL_BLACKLIST = `
DO NOT capture as a skill (this is critical — these poison future turns):
- Environment-dependent failures: missing binaries, fresh-install errors,
  "command not found", unconfigured credentials. The user can fix these —
  they are not durable rules.
- Negative claims about tools ("browser tools don't work", "X is broken").
  These harden into refusals the agent cites against itself for months
  after the actual problem was fixed.
- Transient session errors that resolved themselves.
- One-off task narratives ("summarise today's market" is not a task class).
If a tool failed because of setup state, capture the FIX (the install
command, the env var) under a troubleshooting skill — never "this tool is
broken" as a loose constraint.`;

/** Review solo de memoria. */
export const MEMORY_REVIEW_PROMPT = `Review the conversation above and consider saving durable information to memory.

Focus on:
1. Has the user revealed things about themselves — their persona, desires,
   preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their
   work style, or ways they want you to operate?

Write memories as DECLARATIVE FACTS, not instructions to yourself.
"User prefers concise responses" — correct.
"Always respond concisely" — wrong (it re-reads as a directive and
overrides the user's actual request).

Do NOT save: task progress, completed-work logs, PR numbers, commit SHAs,
"Phase N done", or anything that will be stale in 7 days.

If nothing stands out, return an empty "memory" array.
${OUTPUT_CONTRACT}`;

/** Review solo de skills — el más elaborado. */
export const SKILL_REVIEW_PROMPT = `Review the conversation above and consider creating or updating a skill.

Be ACTIVE — most sessions produce at least one skill update. A pass that
does nothing is a missed learning opportunity, not a neutral outcome.
But quality over quantity: the target is a small set of CLASS-LEVEL
"umbrella" skills with rich content, NOT a flat list of one-session skills.

Signals that justify capturing a skill (any one is enough):
- The user corrected your style/tone/format/verbosity. Frustration with how
  you work is a FIRST-CLASS skill signal — "stop doing X", "too verbose",
  "just give me the answer".
- The user corrected your workflow or the sequence of steps.
- A non-trivial technique, fix, or workaround emerged.
- A skill used this session turned out wrong or incomplete.

When you do capture a skill, name the CLASS of task, never a PR number,
error string, codename, library name alone, or "fix-X / debug-Y" artifact.
${SKILL_BLACKLIST}

If nothing is worth capturing, return an empty "skills" array.
${OUTPUT_CONTRACT}`;

/** Review combinado (ambos nudges en el mismo turno). */
export const COMBINED_REVIEW_PROMPT = `Review the conversation above for BOTH memory and skills.

The division: memory says "who the user is and what the current state of
your operations is"; skills say "how to do this class of task for this
user". Never mix them — procedural knowledge in memory poisons future
turns because memory is re-injected as a directive.

MEMORY — declarative facts about the user (preferences, persona, work
style). Not instructions. Not stale task state.

SKILLS — recurring procedures, techniques, fixes. Be active; aim for
class-level umbrella skills.
${SKILL_BLACKLIST}
${OUTPUT_CONTRACT}`;

/** Elige el prompt según qué nudges dispararon. */
export function buildReviewPrompt(reviewMemory: boolean, reviewSkills: boolean): string {
  if (reviewMemory && reviewSkills) return COMBINED_REVIEW_PROMPT;
  if (reviewSkills) return SKILL_REVIEW_PROMPT;
  return MEMORY_REVIEW_PROMPT;
}
