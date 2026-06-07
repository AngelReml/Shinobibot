/**
 * Validación REAL del cableado P2 de Dreaming.
 * Siembra una memoria con mensajes en 2 días distintos y corre el ciclo de
 * dreaming real; comprueba que se generan los dream files markdown por día.
 *
 * Run: npx tsx scripts/audit_validation/p2_dreaming_real.ts
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'shinobi-dream-'));
  process.chdir(work);

  // memory.json con mensajes en 2 días distintos.
  const mem = [
    { role: 'user', content: 'ejecuta read_file sobre config.ts y edit_file para arreglarlo', timestamp: '2026-05-14T09:00:00.000Z' },
    { role: 'assistant', content: 'He usado read_file y edit_file. Decidí refactorizar el módulo de auth.', timestamp: '2026-05-14T09:01:00.000Z' },
    { role: 'user', content: 'otra vez read_file y edit_file, prefiero typescript estricto', timestamp: '2026-05-15T10:00:00.000Z' },
    { role: 'assistant', content: 'Usé read_file y edit_file de nuevo. Decidí activar strict mode.', timestamp: '2026-05-15T10:01:00.000Z' },
  ];
  writeFileSync(join(work, 'memory.json'), JSON.stringify(mem, null, 2), 'utf-8');

  const { runDreamingCycle, _resetDreamingWiring } = await import('../../src/memory/dreaming/dreaming_wiring.js');
  _resetDreamingWiring();
  const dreamsDir = join(work, 'dreams');

  console.log('=== runDreamingCycle (force) ===');
  const r1 = await runDreamingCycle({ dreamsDir, force: true });
  console.log(`  reports=${r1.reports}, files=[${r1.files.map((f) => f.split(/[\\/]/).pop()).join(', ')}]`);
  check('genera un dream file por día con datos', r1.reports >= 2, `${r1.reports} reports`);

  const dreamFiles = existsSync(dreamsDir) ? readdirSync(dreamsDir).filter((f) => f.endsWith('.md')) : [];
  check('los dream files existen en disco', dreamFiles.length >= 2, dreamFiles.join(', '));

  if (dreamFiles.length > 0) {
    const sample = readFileSync(join(dreamsDir, dreamFiles[dreamFiles.length - 1]), 'utf-8');
    console.log('\n=== Dream file (extracto) ===');
    console.log(sample.split('\n').slice(0, 14).join('\n'));
    check('el dream file tiene la estructura esperada',
      sample.includes('# Dream') && sample.includes('Entidades'), 'secciones de dream');
  }

  console.log('\n=== Idempotencia por día ===');
  const r2 = await runDreamingCycle({ dreamsDir }); // sin force, mismo día de proceso
  console.log(`  segunda llamada (sin force) -> reports=${r2.reports}`);
  check('no re-procesa el mismo día (idempotente)', r2.reports === 0, 'segunda llamada = 0 reports');

  process.chdir(tmpdir());
  try { rmSync(work, { recursive: true, force: true }); } catch {}
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
