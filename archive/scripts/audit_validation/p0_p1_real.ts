/**
 * Validación REAL de los fixes P0/P1 que NO necesitan credenciales.
 * Ejecuta el código real contra dependencias reales (fs, powershell.exe) y
 * produce output observable. NO es smoke test: cada check ejercita el
 * camino real arreglado.
 *
 * Run: npx tsx scripts/audit_validation/p0_p1_real.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { validatePath } from '../../src/utils/permissions.js';
import { checkDestructive } from '../../src/tools/run_command.js';
import { runPowerShell } from '../../src/tools/_powershell.js';
import { Memory } from '../../src/db/memory.js';
import { LocalJsonProvider } from '../../src/memory/providers/local_json.js';
import { createBackup, restoreBackup } from '../../src/backup/state_backup.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'shinobi-realval-'));

  // ── C5 — validatePath: bypass por prefijo de hermano ──────────────────
  console.log('\n=== C5 · validatePath (path traversal por prefijo) ===');
  process.env.WORKSPACE_ROOT = join(work, 'app');
  mkdirSync(process.env.WORKSPACE_ROOT, { recursive: true });
  const sibling = validatePath(join(work, 'app-evil', 'x.txt'));
  const inside = validatePath(join(work, 'app', 'sub', 'x.txt'));
  console.log(`  sibling (app-evil): allowed=${sibling.allowed} reason="${sibling.reason ?? ''}"`);
  console.log(`  inside  (app/sub):  allowed=${inside.allowed}`);
  check('C5 dir hermano con prefijo común RECHAZADO', sibling.allowed === false, 'app-evil debe quedar fuera');
  check('C5 ruta realmente dentro PERMITIDA', inside.allowed === true, 'app/sub debe pasar');

  // ── C4 — checkDestructive: evasión + falsos positivos ─────────────────
  console.log('\n=== C4 · checkDestructive (blacklist) ===');
  const cases: Array<[string, boolean]> = [
    ['rm -rf /', true],
    ['t^askkill /im chrome.exe', true],   // evasión con ^ de cmd
    ['ki"ll 1234', true],                  // evasión con comillas
    ['shutdown /s /t 0', true],
    ['reg delete HKLM\\Software\\X /f', true],
    ['npm run format', false],             // falso positivo viejo: ahora NO bloquea
    ['git status', false],
  ];
  for (const [cmd, shouldBlock] of cases) {
    const blocked = checkDestructive(cmd) !== null;
    check(`C4 "${cmd}"`, blocked === shouldBlock, `bloqueado=${blocked} (esperado ${shouldBlock})`);
  }

  // ── C3 — runPowerShell: script con comillas dobles (rompía pre-fix) ───
  console.log('\n=== C3 · runPowerShell (EncodedCommand, ejecuta powershell.exe real) ===');
  const psR = await runPowerShell(`Write-Output 'he said "hello" & ok'`);
  console.log(`  exitCode=${psR.exitCode} stdout=${JSON.stringify(psR.stdout.trim())}`);
  check('C3 script con " ejecuta correctamente', psR.success && psR.stdout.includes('he said "hello" & ok'),
    'el output debe contener las comillas literales');

  // ── C7 — memory.json: escrituras concurrentes sin lost-update ─────────
  console.log('\n=== C7 · Memory addMessage concurrente (escritura atómica + cola) ===');
  const memFile = join(work, 'memory.json');
  const mem = new Memory(memFile);
  const N = 20;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      mem.addMessage({ role: 'assistant', content: `mensaje-concurrente-${i}` })),
  );
  const stored = await mem.getMessages();
  let validJson = false;
  try { JSON.parse(readFileSync(memFile, 'utf-8')); validJson = true; } catch {}
  console.log(`  ${N} addMessage concurrentes -> ${stored.length} mensajes en disco; JSON válido=${validJson}`);
  check('C7 sin lost-update bajo concurrencia', stored.length === N, `esperado ${N}, hay ${stored.length}`);
  check('C7 fichero no corrupto', validJson, 'memory.json debe parsear');

  // ── C6 — LocalJsonProvider: persistencia entre instancias (reinicio) ──
  console.log('\n=== C6 · LocalJsonProvider persiste tras "reinicio" ===');
  const provFile = join(work, 'provider.json');
  const p1 = new LocalJsonProvider(provFile);
  await p1.init();
  await p1.store({ role: 'user', content: 'recuerda que el cafe es a las nueve' });
  await p1.shutdown();
  const p2 = new LocalJsonProvider(provFile);  // instancia nueva = simula reinicio del proceso
  await p2.init();
  const hits = await p2.recall('cafe nueve', 5);
  console.log(`  tras 'reinicio': recall devolvió ${hits.length} hit(s); top="${hits[0]?.message.content ?? ''}"`);
  check('C6 la memoria sobrevive a un reinicio del proceso',
    hits.length > 0 && hits[0].message.content.includes('cafe'),
    'una instancia nueva debe recuperar lo almacenado');

  // ── restoreBackup — archivo redactado NO machaca el original ──────────
  console.log('\n=== P1 · restoreBackup no clobbera el audit real ===');
  const sroot = join(work, 'sroot');
  mkdirSync(join(sroot, 'audit'), { recursive: true });
  writeFileSync(join(sroot, 'USER.md'), '# user', 'utf-8');
  writeFileSync(join(sroot, 'audit', 'audit.jsonl'),
    '{"tool":"x","args":"AUTH=Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firma"}\n', 'utf-8');
  const staging = join(work, 'staging');
  createBackup({ shinobiRoot: sroot, stagingDir: staging });
  const dest = join(work, 'restored');
  mkdirSync(dest);
  // el dest ya tiene un audit "real" que NO debe ser sobrescrito
  mkdirSync(join(dest, 'audit'), { recursive: true });
  writeFileSync(join(dest, 'audit', 'audit.jsonl'), 'AUDIT REAL — no tocar', 'utf-8');
  restoreBackup({ stagingDir: staging, destDir: dest, overwrite: true });
  const auditReal = readFileSync(join(dest, 'audit', 'audit.jsonl'), 'utf-8');
  const sidecarExists = existsSync(join(dest, 'audit', 'audit.jsonl.from-backup'));
  console.log(`  audit.jsonl real intacto="${auditReal}" ; sidecar .from-backup existe=${sidecarExists}`);
  check('P1 audit.jsonl real NO sobrescrito', auditReal === 'AUDIT REAL — no tocar', 'el original debe quedar intacto');
  check('P1 backup redactado va al sidecar', sidecarExists, '.from-backup debe existir');

  try { rmSync(work, { recursive: true, force: true }); } catch {}
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
