/**
 * Validación REAL — Bucle de aprendizaje, Fase 4 (telemetría sidecar).
 *   - bumpUse/View/Patch/markAgentCreated crean y acumulan registros.
 *   - escritura atómica; un .usage.json corrupto no rompe nada.
 *   - el cableado: getContextSection() bumpea las skills que inyecta.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase4_real.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn4-'));
process.chdir(TMP);

const tel = await import('../../src/learning/skill_telemetry.js');
const { skillManager } = await import('../../src/skills/skill_manager.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

function testCounters() {
  console.log('=== telemetría — contadores ===');
  tel.bumpUse('alpha');
  tel.bumpUse('alpha');
  tel.bumpView('alpha');
  tel.bumpPatch('alpha');
  const r = tel.getUsageRecord('alpha')!;
  console.log(`  alpha: ${JSON.stringify(r)}`);
  check('bumpUse acumula y fija last_used_at', r.use_count === 2 && !!r.last_used_at, `use=${r.use_count}`);
  check('bumpView cuenta aparte de use', r.view_count === 1 && !!r.last_viewed_at, `view=${r.view_count}`);
  check('bumpPatch cuenta aparte', r.patch_count === 1 && !!r.last_patched_at, `patch=${r.patch_count}`);
  check('una skill nueva nace created_by=user (conservador)', r.created_by === 'user', `created_by=${r.created_by}`);
  check('estado inicial active, no pinned, no archivada', r.state === 'active' && !r.pinned && r.archived_at === null, r.state);

  tel.markAgentCreated('beta');
  check('markAgentCreated marca created_by=agent', tel.getUsageRecord('beta')?.created_by === 'agent', 'beta=agent');
  check('el sidecar .usage.json existe en skills/', existsSync(join(TMP, 'skills', '.usage.json')), 'skills/.usage.json');
}

function testCorruptResilience() {
  console.log('\n=== telemetría — resiliencia a sidecar corrupto ===');
  writeFileSync(join(TMP, 'skills', '.usage.json'), '{ esto no es json válido', 'utf-8');
  const loaded = tel.loadUsage();
  check('un .usage.json corrupto se lee como {}', Object.keys(loaded).length === 0, 'devolvió {}');
  // bumpUse sobre el fichero corrupto: no lanza, lo reescribe válido.
  let threw = false;
  try { tel.bumpUse('gamma'); } catch { threw = true; }
  check('bumpUse sobre un sidecar corrupto no lanza', !threw, 'best-effort OK');
  check('y reescribe el sidecar válido', tel.getUsageRecord('gamma')?.use_count === 1, 'gamma recuperado');
}

async function testWiring() {
  console.log('\n=== cableado — getContextSection bumpea lo que inyecta ===');
  const approvedDir = join(TMP, 'skills', 'approved');
  mkdirSync(approvedDir, { recursive: true });
  writeFileSync(join(approvedDir, 'pr-review.skill.md'),
    '---\nname: pr-review\ndescription: Como revisar un PR.\ntrigger_keywords: [pr]\nstatus: approved\n---\n' +
    '# PR Review\nComprueba tests, lint y changelog.\n', 'utf-8');

  const mgr = skillManager();
  mgr.loadApproved();
  const section = mgr.getContextSection('necesito revisar un PR antes de mergear');
  check('getContextSection inyecta la skill que matchea', !!section && /pr-review/i.test(section ?? ''),
    section ? 'skill inyectada' : 'sin match');
  const rec = tel.getUsageRecord('pr-review');
  check('la skill inyectada quedó bumpeada en .usage.json', !!rec && rec.use_count >= 1,
    rec ? `use_count=${rec.use_count}` : 'sin registro');
}

async function main() {
  testCounters();
  testCorruptResilience();
  await testWiring();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
