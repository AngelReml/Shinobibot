/**
 * Validación REAL: cada entrada de DESTRUCTIVE_TOOLS corresponde a una tool
 * REGISTRADA, e isDestructive() la marca como destructiva.
 *
 * Cierra la clase de bug "nombre-de-archivo vs nombre-registrado" que ha
 * aparecido 3 veces (request_new_skill, task_scheduler_create, cloud_mission):
 * una entrada con el nombre equivocado deja la tool sin gate de aprobación.
 *
 * Run: npx tsx scripts/audit_validation/p6_destructive_tools_real.ts
 */
import '../../src/tools/index.js'; // registra todas las tools
import { getAllTools } from '../../src/tools/tool_registry.js';
import { DESTRUCTIVE_TOOLS, isDestructive, isReadOnly } from '../../src/security/approval.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

const registered = new Set(getAllTools().map((t) => t.name));
console.log(`tools registradas: ${registered.size}`);

// 1. Cada entrada de DESTRUCTIVE_TOOLS debe ser una tool registrada real.
console.log('\n=== DESTRUCTIVE_TOOLS vs tools registradas ===');
const huérfanas: string[] = [];
for (const t of DESTRUCTIVE_TOOLS) {
  if (registered.has(t)) {
    console.log(`  OK   ${t}`);
  } else {
    huérfanas.push(t);
    console.log(`  HUÉRFANA  ${t}  <- ninguna tool registrada con ese nombre`);
  }
}
check('toda entrada de DESTRUCTIVE_TOOLS es una tool registrada', huérfanas.length === 0,
  huérfanas.length ? `huérfanas: ${huérfanas.join(', ')}` : 'sin huérfanas');

// 2. isDestructive() marca start_cloud_mission como destructiva (el bug).
console.log('\n=== gate de start_cloud_mission ===');
const v = isDestructive('start_cloud_mission', { prompt: 'x' });
check('isDestructive(start_cloud_mission) = true', v.destructive === true,
  `destructive=${v.destructive}, reason=${v.reason ?? ''}`);

// 3. Cada tool destructiva pasa el gate; un sondeo de read-only NO.
console.log('\n=== cada tool destructiva pide confirmación ===');
let allGated = true;
for (const t of DESTRUCTIVE_TOOLS) {
  if (!registered.has(t)) continue;
  const d = isDestructive(t, { command: 'x', path: 'C:/Windows/System32/x', taskName: 't', schedule: 'ONCE' });
  // run_command/write_file/edit_file dependen del arg; el resto debe dar true directo.
  const expectedDirect = !['run_command', 'write_file', 'edit_file'].includes(t);
  if (expectedDirect && d.destructive !== true) { allGated = false; console.log(`  FALLA  ${t} -> destructive=${d.destructive}`); }
}
check('todas las tools destructivas (no-arg-dependientes) dan destructive=true', allGated, 'gate efectivo');
check('control: read_file sigue siendo read-only', isReadOnly('read_file') === true, 'read_file read-only');

console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
