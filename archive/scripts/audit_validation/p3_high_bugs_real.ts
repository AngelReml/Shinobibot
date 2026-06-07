/**
 * Validación REAL de los 2 bugs HIGH del 3er ciclo de auditoría:
 *   #A state_backup — el audit.jsonl real (raíz) ahora SÍ entra en el backup.
 *   #B task_scheduler_create — ahora es destructiva → pasa por el gate.
 *
 * Run: npx tsx scripts/audit_validation/p3_high_bugs_real.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup } from '../../src/backup/state_backup.js';
import { isDestructive, DESTRUCTIVE_TOOLS } from '../../src/security/approval.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

function testStateBackup() {
  console.log('=== #A state_backup — audit.jsonl en la ruta REAL (raíz) ===');
  const root = mkdtempSync(join(tmpdir(), 'shinobi-bk-root-'));
  const staging = mkdtempSync(join(tmpdir(), 'shinobi-bk-stg-'));
  // El audit log REAL se escribe en <cwd>/audit.jsonl (raíz), no en audit/.
  writeFileSync(join(root, 'audit.jsonl'),
    '{"tool":"run_command","args":"AUTH=Bearer eyJhbGciOiJIUzI1NiJ9.payload.signaturepart"}\n', 'utf-8');
  writeFileSync(join(root, 'USER.md'), '# Usuario', 'utf-8');

  const r: any = createBackup({ shinobiRoot: root, stagingDir: staging });
  const files = r.manifest?.files ?? [];
  const auditEntry = files.find((f: any) => String(f.relPath).includes('audit.jsonl'));
  console.log(`  files en el manifest: ${files.map((f: any) => f.relPath).join(', ')}`);
  check('audit.jsonl entra en el backup', !!auditEntry,
    auditEntry ? `relPath=${auditEntry.relPath}, redacted=${auditEntry.redacted}` : 'NO está en el backup');
  check('audit.jsonl se respalda REDACTADO', !!auditEntry && auditEntry.redacted === true,
    auditEntry?.redacted ? 'redacted=true' : 'sin redactar');
}

function testTaskSchedulerGate() {
  console.log('\n=== #B task_scheduler_create — gate de confirmación ===');
  const inList = DESTRUCTIVE_TOOLS.has('task_scheduler_create');
  check('task_scheduler_create está en DESTRUCTIVE_TOOLS', inList, inList ? 'registrada' : 'ausente');

  const verdict = isDestructive('task_scheduler_create', { taskName: 't', command: 'calc.exe', schedule: 'ONCE' });
  console.log(`  isDestructive(task_scheduler_create) -> ${JSON.stringify(verdict)}`);
  check('isDestructive marca task_scheduler_create como destructiva', verdict.destructive === true,
    verdict.destructive ? 'destructive=true → pide confirmación' : 'NO se considera destructiva');

  // Contraste: una tool de solo lectura NO debe marcarse destructiva.
  const ro = isDestructive('read_file', { path: '/tmp/x' });
  check('control: read_file sigue siendo no-destructiva', ro.destructive === false,
    `read_file destructive=${ro.destructive}`);
}

testStateBackup();
testTaskSchedulerGate();
console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
