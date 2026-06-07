/**
 * Validación REAL — Bucle de aprendizaje, Fase 6 (Curator / Motor 2).
 *   - shouldRunCurator: opt-in, first-run difiere.
 *   - Fase A: archiva >90d, marca stale >30d, reactiva, salta pinned, e
 *     IGNORA las skills del usuario (gate de la Fase 5).
 *   - Fase B: con stub LLM produce recomendaciones de consolidación.
 *   - getContextSection NO inyecta una skill archivada.
 *   - reporte run.json + REPORT.md en disco.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase6_real.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn6-'));
process.chdir(TMP);
mkdirSync(join(TMP, 'skills'), { recursive: true });

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

// Sidecar sintético con skills de edades controladas.
function rec(over: any) {
  return {
    created_by: 'agent', use_count: 0, view_count: 0, patch_count: 0,
    last_used_at: null, last_viewed_at: null, last_patched_at: null,
    created_at: iso(0), state: 'active', pinned: false, archived_at: null, ...over,
  };
}
writeFileSync(join(TMP, 'skills', '.usage.json'), JSON.stringify({
  'skill-ancient':   rec({ created_at: iso(120 * DAY) }),
  'skill-stale':     rec({ created_at: iso(45 * DAY) }),
  'skill-fresh':     rec({ created_at: iso(5 * DAY) }),
  'skill-pinned':    rec({ created_at: iso(200 * DAY), pinned: true }),
  'skill-reactiv':   rec({ created_at: iso(200 * DAY), last_used_at: iso(5 * DAY), state: 'stale' }),
  'skill-user':      rec({ created_at: iso(300 * DAY), created_by: 'user' }),
}, null, 2), 'utf-8');

const cur = await import('../../src/learning/skill_curator.js');
const tel = await import('../../src/learning/skill_telemetry.js');
const { skillManager } = await import('../../src/skills/skill_manager.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const cloud = (t: string) => ({ success: true, output: JSON.stringify({ content: t }), error: '' });

function testGate() {
  console.log('=== shouldRunCurator — gate ===');
  delete process.env.SHINOBI_CURATOR_ENABLED;
  check('sin SHINOBI_CURATOR_ENABLED no corre', cur.shouldRunCurator() === false, 'off por defecto');
  process.env.SHINOBI_CURATOR_ENABLED = '1';
  check('first-run NO corre (siembra last_run_at y difiere)', cur.shouldRunCurator() === false, 'first-run difiere');
  check('tras el first-run se creó .curator_state', existsSync(join(TMP, 'skills', '.curator_state')), 'estado sembrado');
}

async function testCycle() {
  console.log('\n=== runCuratorCycle — Fase A + B ===');
  const r = await cur.runCuratorCycle({
    invoker: (async () => cloud('skill-stale + skill-fresh -> skill-tools: comparten dominio')) as any,
  });
  console.log(`  archived=${JSON.stringify(r.archived)} staled=${JSON.stringify(r.staled)} reactivated=${JSON.stringify(r.reactivated)}`);

  check('archiva la skill >90d', r.archived.includes('skill-ancient'), `archived=${r.archived}`);
  check('marca stale la skill >30d y <90d', r.staled.includes('skill-stale'), `staled=${r.staled}`);
  check('reactiva la skill stale que volvió a usarse', r.reactivated.includes('skill-reactiv'), `reactivated=${r.reactivated}`);
  check('NO archiva la skill fresca (<30d)', !r.archived.includes('skill-fresh') && !r.staled.includes('skill-fresh'), 'skill-fresh intacta');
  check('NO toca la skill pinned aunque sea de 200d', !r.archived.includes('skill-pinned') && !r.staled.includes('skill-pinned'), 'pinned saltada');
  check('IGNORA la skill del usuario (gate Fase 5)', !r.archived.includes('skill-user') && !r.staled.includes('skill-user'), 'skill-user fuera del Curator');

  check('Fase B produce recomendaciones de consolidación', /skill-tools/.test(r.consolidationAdvice), `advice: "${r.consolidationAdvice.slice(0, 60)}"`);
  check('escribe el reporte run.json + REPORT.md',
    !!r.reportDir && existsSync(join(r.reportDir, 'run.json')) && existsSync(join(r.reportDir, 'REPORT.md')),
    r.reportDir ?? 'sin reporte');

  // Telemetría tras la pasada.
  check('skill-ancient quedó state=archived en la telemetría', tel.getUsageRecord('skill-ancient')?.state === 'archived', 'archived');
  check('skill-ancient sale de los candidatos del Curator', !tel.listAgentCreatedSkillNames().includes('skill-ancient'), 'fuera de candidatos');
}

async function testArchivedNotInjected() {
  console.log('\n=== getContextSection NO inyecta una skill archivada ===');
  const approvedDir = join(TMP, 'skills', 'approved');
  mkdirSync(approvedDir, { recursive: true });
  // skill-ancient ya está archivada en la telemetría; su SKILL.md existe.
  writeFileSync(join(approvedDir, 'skill-ancient.skill.md'),
    '---\nname: skill-ancient\ndescription: vieja.\ntrigger_keywords: [arcaico]\nstatus: approved\n---\n# Ancient\nPaso.\n', 'utf-8');
  const mgr = skillManager();
  mgr.loadApproved();
  const section = mgr.getContextSection('necesito algo arcaico');
  check('una skill archivada por el Curator no se inyecta', section === null || !/skill-ancient/.test(section),
    section ? 'no inyectada' : 'sin match (correcto)');
}

async function main() {
  testGate();
  await testCycle();
  await testArchivedNotInjected();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
