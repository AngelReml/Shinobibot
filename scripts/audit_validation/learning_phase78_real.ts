/**
 * Validación REAL — Bucle de aprendizaje, Fases 7+8.
 *   Fase 7: el prompt de generación de skills sesga a skill-paraguas +
 *           estándares de autoría.
 *   Fase 8: el tool `memory` — escritura de memoria EN VIVO por el agente,
 *           con el guard declarativo de la Fase 3.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase78_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn78-'));
process.chdir(TMP);

const { skillManager, setLLMInvokerForTesting } = await import('../../src/skills/skill_manager.js');
const memoryTool = (await import('../../src/tools/memory_tool.js')).default;
const { getAllTools } = await import('../../src/tools/tool_registry.js');
const { curatedMemory } = await import('../../src/memory/curated_memory.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const cloud = (t: string) => ({ success: true, output: JSON.stringify({ content: t }), error: '' });

async function testPhase7() {
  console.log('=== Fase 7 — sesgo a skill-paraguas en el prompt de generación ===');
  let capturedPrompt = '';
  setLLMInvokerForTesting(async (payload: any) => {
    capturedPrompt = String(payload?.messages?.[0]?.content ?? '');
    return cloud('---\nname: demo\ndescription: Demo.\ntrigger_keywords: [demo]\n---\n# Demo\nPaso 1.\n');
  });
  await skillManager().proposeSkill('CTX revisar PRs', 'manual');
  setLLMInvokerForTesting(null);

  check('el prompt sesga a skill CLASS-LEVEL', /CLASS-LEVEL/i.test(capturedPrompt), 'CLASS-LEVEL presente');
  check('el prompt prefiere umbrella sobre skills estrechas', /umbrella/i.test(capturedPrompt), 'umbrella presente');
  check('el prompt impone la regla de description <=60 chars', /60 chars/i.test(capturedPrompt), 'regla de description');
  check('el prompt fija el orden de secciones (When to Use, Pitfalls...)',
    /When to Use/.test(capturedPrompt) && /Pitfalls/.test(capturedPrompt), 'estructura de secciones');
}

async function testPhase8() {
  console.log('\n=== Fase 8 — tool `memory` (escritura en vivo) ===');
  curatedMemory().loadAtBoot();

  check('el tool `memory` está registrado', getAllTools().some((t) => t.name === 'memory'), 'memory en el registro');

  // add declarativo -> guardado.
  const ok = await memoryTool.execute({ content: 'el usuario prefiere respuestas en español' });
  check('guarda un hecho declarativo', ok.success === true, ok.output || ok.error || '');
  check('el hecho aparece en MEMORY.md', /respuestas en español/.test(curatedMemory().showMemory()), 'persistido');

  // imperativo -> rechazado por el guard de la Fase 3.
  const imp = await memoryTool.execute({ content: 'Always answer in Spanish' });
  check('rechaza una directiva imperativa', imp.success === false && /declarativ/i.test(imp.error ?? ''),
    `error: ${imp.error}`);
  check('la directiva NO se escribió en MEMORY.md', !/Always answer in Spanish/.test(curatedMemory().showMemory()), 'no persistida');

  // content vacío -> error claro.
  const empty = await memoryTool.execute({ content: '   ' });
  check('content vacío da error accionable', empty.success === false && /required/.test(empty.error ?? ''), empty.error ?? '');
}

async function main() {
  await testPhase7();
  await testPhase8();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
