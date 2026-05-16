/**
 * Validación REAL de los 2 fixes de mayor severidad de la re-auditoría:
 *   1. task_scheduler_create — inyección de comandos (patrón C3 reintroducido).
 *   2. process_lock — unhandledRejection ya no mata el proceso residente.
 *
 * Run: npx tsx scripts/audit_validation/p3_reaudit_fixes_real.ts
 */
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import schtasksTool from '../../src/tools/task_scheduler_create.js';
import { acquireLock } from '../../src/runtime/process_lock.js';

const execFileP = promisify(execFile);
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function testInjection() {
  console.log('=== 1. task_scheduler_create — inyección de comandos ===');
  const tmp = process.env.TEMP || process.env.TMP || '.';
  const sentinel = join(tmp, 'shinobi_pwned_probe.txt');
  if (existsSync(sentinel)) rmSync(sentinel);

  const taskName = 'shinobi-injtest-' + Date.now();
  // Payload NO destructivo (pasa la blacklist) pero con metacaracteres de
  // cmd.exe: si la creación pasara por un shell, escribiría el centinela.
  const payload = `cmd.exe /c rem" & echo PWNED > "${sentinel}" & echo "`;

  const r: any = await schtasksTool.execute({
    taskName, command: payload, schedule: 'ONCE', startTime: '23:59',
  });
  console.log(`  execute -> success=${r.success}  ${(r.error || r.output || '').slice(0, 140)}`);

  // Limpieza: borra la tarea si se llegó a crear.
  try { await execFileP('schtasks.exe', ['/Delete', '/TN', taskName, '/F']); } catch { /* no existía */ }

  const pwned = existsSync(sentinel);
  if (pwned) rmSync(sentinel);
  check('la creación NO ejecuta el payload inyectado', !pwned,
    pwned ? 'INYECCIÓN: el centinela se creó' : 'sin centinela — el payload viajó como dato, no como comando');
}

function testProcessLock() {
  console.log('\n=== 2. process_lock — unhandledRejection no fatal ===');
  const tmpLock = join(process.env.TEMP || '.', 'shinobi-test-' + Date.now() + '.lock');
  acquireLock('reaudit-test', tmpLock); // instala los handlers de process
  console.log('  acquireLock OK — handlers instalados; lanzando una promesa rechazada sin catch...');

  // Promesa rechazada y NO capturada -> dispara 'unhandledRejection'.
  // Con el código viejo: process.exit(1) -> este harness muere aquí.
  // Con el fix: solo se loguea y el proceso continúa.
  Promise.reject(new Error('shinobi-test-rejection-intencionada'));

  setTimeout(() => {
    // Si llegamos aquí, el proceso sobrevivió al unhandledRejection.
    check('el proceso sigue vivo tras un unhandledRejection', true, 'no hubo process.exit(1)');
    try { if (existsSync(tmpLock)) rmSync(tmpLock); } catch { /* */ }
    console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
    process.exit(fail > 0 ? 1 : 0);
  }, 400);
}

async function main() {
  await testInjection();
  testProcessLock(); // debe ir el último: termina el harness desde un setTimeout.
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
