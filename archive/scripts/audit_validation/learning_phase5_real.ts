/**
 * Validación REAL — Bucle de aprendizaje, Fase 5 (provenance + gate).
 *   - una skill nacida del agente (review/failure/pattern) -> created_by='agent'.
 *   - una skill propuesta manual por el usuario -> created_by='user' (sin marca).
 *   - listAgentCreatedSkillNames() = el gate de candidatos del Curator:
 *     solo las 'agent', nunca las del usuario.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase5_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn5-'));
process.chdir(TMP);

const { skillManager, setLLMInvokerForTesting } = await import('../../src/skills/skill_manager.js');
const tel = await import('../../src/learning/skill_telemetry.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const cloud = (text: string) => ({ success: true, output: JSON.stringify({ content: text }), error: '' });

async function main() {
  // El invoker stub deriva el nombre de la skill del tag CTX-<kind> del prompt.
  setLLMInvokerForTesting(async (payload: any) => {
    const prompt = String(payload?.messages?.[0]?.content ?? '');
    const tag = (prompt.match(/CTX-(\w+)/) || [, 'x'])[1];
    return cloud(`---\nname: skill-${tag}\ndescription: Skill de prueba ${tag}.\ntrigger_keywords: [${tag}]\n---\n# Skill ${tag}\nPaso 1.\n`);
  });

  console.log('=== propuestas por kind ===');
  const review = await skillManager().proposeSkill('CTX-review revisar PRs', 'review');
  const failure = await skillManager().proposeSkill('CTX-failure recuperar de un fallo', 'failure');
  const pattern = await skillManager().proposeSkill('CTX-pattern secuencia repetida', 'pattern');
  const manual = await skillManager().proposeSkill('CTX-manual lo pidió el usuario', 'manual');
  console.log(`  review=${review.name} failure=${failure.name} pattern=${pattern.name} manual=${manual.name}`);
  check('las 4 propuestas se generan', !!(review.ok && failure.ok && pattern.ok && manual.ok), 'ok');

  console.log('\n=== gate de provenance ===');
  check("skill 'review' -> created_by=agent", tel.getUsageRecord('skill-review')?.created_by === 'agent', 'agent');
  check("skill 'failure' -> created_by=agent", tel.getUsageRecord('skill-failure')?.created_by === 'agent', 'agent');
  check("skill 'pattern' -> created_by=agent", tel.getUsageRecord('skill-pattern')?.created_by === 'agent', 'agent');
  check("skill 'manual' NO recibe marca de agente", tel.getUsageRecord('skill-manual') === null,
    'sin registro agent (es del usuario)');

  // Una skill del usuario que acumula telemetría sigue siendo 'user'.
  tel.bumpUse('skill-manual');
  check("skill 'manual' con telemetría sigue created_by=user", tel.getUsageRecord('skill-manual')?.created_by === 'user', 'user');

  console.log('\n=== listAgentCreatedSkillNames — candidatos del Curator ===');
  const agentSkills = tel.listAgentCreatedSkillNames().sort();
  console.log(`  candidatos: ${agentSkills.join(', ')}`);
  check('incluye las 3 skills nacidas del agente',
    ['skill-failure', 'skill-pattern', 'skill-review'].every((s) => agentSkills.includes(s)),
    `${agentSkills.length} candidatos`);
  check('EXCLUYE la skill del usuario (gate efectivo)', !agentSkills.includes('skill-manual'),
    'skill-manual fuera de los candidatos');

  setLLMInvokerForTesting(null);
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
