/**
 * Validación REAL — Bucle de aprendizaje, Fases 1+2.
 *   Fase 2: los 3 prompts de review + la lista negra.
 *   Fase 1: runBackgroundReview — decisión LLM (stub) + despacho real a
 *           curatedMemory().appendEnv() y skillManager().proposeSkill().
 *
 * El LLM real (modelo auxiliar OpenRouter) necesita credencial → se stubea
 * el invoker; lo que se valida REAL es el código de Shinobi: construcción
 * de prompts, parseo de la decisión y despacho por las rutas auditadas.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase12_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Aísla el cwd ANTES de tocar los singletons (curatedMemory/skillManager
// resuelven sus paths desde process.cwd()).
const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn-'));
process.chdir(TMP);

const { runBackgroundReview } = await import('../../src/learning/background_review.js');
const { buildReviewPrompt, SKILL_REVIEW_PROMPT, MEMORY_REVIEW_PROMPT, COMBINED_REVIEW_PROMPT } =
  await import('../../src/learning/review_prompts.js');
const { curatedMemory } = await import('../../src/memory/curated_memory.js');
const { skillManager, setLLMInvokerForTesting } = await import('../../src/skills/skill_manager.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

/** Construye un CloudResponse cuyo content es `text`. */
const cloud = (text: string) => ({ success: true, output: JSON.stringify({ content: text }), error: undefined });

const HISTORY = [
  { role: 'user', content: 'no me des respuestas tan largas, ve al grano' },
  { role: 'assistant', content: 'Entendido, seré conciso.' },
  { role: 'user', content: 'revisa este PR: comprueba tests, lint y el changelog' },
  { role: 'assistant', content: 'PR revisado: tests OK, lint OK, changelog actualizado.' },
];

function testPrompts() {
  console.log('=== Fase 2 — prompts de review ===');
  check('buildReviewPrompt(mem) elige el prompt de memoria', buildReviewPrompt(true, false) === MEMORY_REVIEW_PROMPT, 'memory');
  check('buildReviewPrompt(skill) elige el prompt de skills', buildReviewPrompt(false, true) === SKILL_REVIEW_PROMPT, 'skill');
  check('buildReviewPrompt(ambos) elige el combinado', buildReviewPrompt(true, true) === COMBINED_REVIEW_PROMPT, 'combined');
  const bl = SKILL_REVIEW_PROMPT;
  check('el prompt de skills lleva la lista negra (fallos de entorno)', /command not found/i.test(bl), 'incluye "command not found"');
  check('el prompt de skills lleva la lista negra ("X is broken")', /broken|don't work/i.test(bl), 'incluye afirmaciones negativas de tools');
  check('el prompt de skills tiene sesgo a la acción', /missed learning opportunity/i.test(bl), 'sesgo a la acción presente');
}

async function testDispatch() {
  console.log('\n=== Fase 1 — runBackgroundReview: despacho real ===');
  curatedMemory().loadAtBoot(); // crea USER.md/MEMORY.md desde plantilla

  // skill_manager genera el SKILL.md con su propio LLM — se stubea.
  setLLMInvokerForTesting(async () => cloud(
    '---\nname: pr-review\ndescription: Como revisar un PR.\ntrigger_keywords: [pr, review]\n---\n# PR Review\n1. Comprueba tests.\n2. Comprueba lint.\n3. Comprueba el changelog.\n'));

  // El invoker del review devuelve una decisión canned.
  const decision = {
    memory: [{ content: 'el usuario prefiere respuestas concisas y directas' }],
    skills: [{ context: 'cómo revisar un PR: tests, lint, changelog' }],
    note: 'preferencia de estilo + skill de PR review',
  };
  const reviewInvoker = async () => cloud(JSON.stringify(decision));

  const r = await runBackgroundReview({
    history: HISTORY, reviewMemory: true, reviewSkills: true, invoker: reviewInvoker as any,
  });
  console.log(`  resultado: ${JSON.stringify(r)}`);
  check('el review se ejecuta sin lanzar y devuelve ok', r.ok === true, `ok=${r.ok}`);
  check('despacha la entrada de memoria a CuratedMemory', r.memorySaved === 1, `memorySaved=${r.memorySaved}`);
  check('despacha la skill a skillManager.proposeSkill', r.skillsProposed === 1, `skillsProposed=${r.skillsProposed}`);

  const mem = curatedMemory().showMemory();
  check('MEMORY.md contiene el hecho declarativo escrito', /respuestas concisas/.test(mem), 'hecho presente en MEMORY.md');
  const pending = skillManager().listPending();
  check('hay una skill en skills/pending/ con source_kind=review',
    pending.some((p) => p.source_kind === 'review'), `${pending.length} pendiente(s)`);

  // Decisión vacía — nada que guardar.
  console.log('\n=== Fase 1 — decisión vacía (nada que guardar) ===');
  const empty = await runBackgroundReview({
    history: HISTORY, reviewMemory: true, reviewSkills: false,
    invoker: (async () => cloud(JSON.stringify({ memory: [], skills: [], note: 'nothing to save' }))) as any,
  });
  check('una decisión vacía no escribe nada y no falla', empty.ok && empty.memorySaved === 0 && empty.skillsProposed === 0,
    `ok=${empty.ok}, mem=${empty.memorySaved}, skills=${empty.skillsProposed}`);

  setLLMInvokerForTesting(null);
}

async function main() {
  testPrompts();
  await testDispatch();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
