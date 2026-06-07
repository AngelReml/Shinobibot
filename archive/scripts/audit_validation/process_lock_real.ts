/**
 * Validación REAL — process_lock robusto frente al reciclaje de PID.
 * El bug: un Shinobi que murió deja shinobi.lock con su PID; Windows
 * reasigna ese PID a otro proceso (p.ej. comet.exe); isAlive() da true y
 * el lock bloquea para siempre el arranque. El fix: lockOwnerAlive()
 * verifica que el proceso del PID sea realmente Node/Shinobi.
 *
 * Run: npx tsx scripts/audit_validation/process_lock_real.ts
 */
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { acquireLock } from '../../src/runtime/process_lock.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

const dir = mkdtempSync(join(tmpdir(), 'shinobi-lock-'));
function fakeLock(p: string, pid: number): void {
  writeFileSync(p, JSON.stringify({ pid, cmd: 'shinobi-web', started_at: new Date().toISOString() }), 'utf-8');
}

// 1. Lock con PID muerto → se reclama.
const p1 = join(dir, 't1.lock');
fakeLock(p1, 999999);
const r1 = acquireLock('shinobi-web', p1);
check('lock con PID muerto se reclama', r1.acquired === true, `acquired=${r1.acquired}`);

// 2. Lock con un PID VIVO pero de otro proceso (PID reciclado) → se reclama.
//    Es exactamente el bug: shinobi.lock apuntaba a un PID que ahora es comet.
let exPid = 0;
try {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq explorer.exe', '/NH', '/FO', 'CSV'],
    { encoding: 'utf-8', windowsHide: true });
  exPid = parseInt((out.match(/"explorer\.exe","(\d+)"/i) ?? [])[1] ?? '0', 10);
} catch { /* */ }
if (exPid > 0) {
  const p2 = join(dir, 't2.lock');
  fakeLock(p2, exPid);
  const r2 = acquireLock('shinobi-web', p2);
  check('lock con PID reciclado por otro proceso (explorer.exe) se reclama',
    r2.acquired === true, `PID ${exPid} (explorer) → acquired=${r2.acquired}`);
} else {
  console.log('[SKIP] no se encontró explorer.exe para el test de PID reciclado');
}

// 3. Lock con un proceso Node REAL y vivo (este harness) → bloquea.
const p3 = join(dir, 't3.lock');
fakeLock(p3, process.pid);
const r3 = acquireLock('shinobi-web', p3);
check('lock de un proceso Node real y vivo SÍ bloquea (sin falso reclamo)',
  r3.acquired === false, `PID ${process.pid} (node) → acquired=${r3.acquired}`);

console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
