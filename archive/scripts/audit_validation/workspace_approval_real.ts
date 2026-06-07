/**
 * Validación REAL — Workspace con permisos absolutos bajo aprobación manual.
 *
 * Fix: cuando el usuario aprueba EXPLÍCITAMENTE en el chat una operación
 * fuera del workspace, Shinobi debe poder escribir en cualquier path del
 * sistema. Sin aprobación, el bloqueo de path traversal se mantiene.
 *
 * Reproduce el flujo REAL del orchestrator (isDestructive → requestApproval
 * → registerApprovedPath → tool.execute) contra el path objetivo del prompt:
 *   C:\Users\angel\Desktop\test_shinobi.txt   (fuera del workspace)
 *
 * El "asker" es la voz del usuario en el chat: stubearlo a 'yes' equivale a
 * que el usuario apruebe; a 'no', a que rechace.
 *
 * Run: npx tsx scripts/audit_validation/workspace_approval_real.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isDestructive,
  requestApproval,
  registerApprovedPath,
  setApprovalMode,
  setApprovalAsker,
} from '../../src/security/approval.js';
import { isPathManuallyApproved } from '../../src/utils/permissions.js';
import writeFileTool from '../../src/tools/write_file.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

/** Reproduce el gate del orchestrator: clasifica, pide aprobación y, si se
 *  concede, registra el path antes de ejecutar la tool. */
async function orchestratorRun(toolName: string, args: any) {
  const verdict = isDestructive(toolName, args);
  const approved = await requestApproval({
    toolName, args, destructive: verdict.destructive, reason: verdict.reason,
  });
  if (!approved) return { approved: false, verdict };
  registerApprovedPath(toolName, args);
  return { approved: true, verdict };
}

async function main() {
  const desktop = path.join(os.homedir(), 'Desktop');
  const target = path.join(desktop, 'test_shinobi.txt');
  console.log(`workspace root : ${process.cwd()}`);
  console.log(`target path    : ${target}  (fuera del workspace)\n`);

  // Limpieza previa — partimos sin el archivo.
  if (fs.existsSync(target)) fs.rmSync(target);

  setApprovalMode('smart');

  // ── Caso 1: SIN aprobación (usuario rechaza) → bloqueo se mantiene ──
  console.log('=== Caso 1: usuario RECHAZA la operación fuera del workspace ===');
  setApprovalAsker(async () => 'no');
  const denyArgs = { path: target, content: 'no debería escribirse' };
  const r1 = await orchestratorRun('write_file', denyArgs);
  check('clasifica la escritura fuera del workspace como destructiva',
    r1.verdict.destructive === true, r1.verdict.reason || '(sin reason)');
  check('aprobación denegada → no se autoriza', r1.approved === false, `approved=${r1.approved}`);
  // El orchestrator no ejecutaría la tool; aun ejecutándola, validatePath bloquea.
  const denyExec = await writeFileTool.execute(denyArgs);
  check('sin aprobación: write_file bloqueado por validatePath',
    denyExec.success === false && /outside the workspace/i.test(denyExec.error || ''),
    denyExec.error || '(sin error)');
  check('archivo NO creado sin aprobación', !fs.existsSync(target), `exists=${fs.existsSync(target)}`);

  // ── Caso 2: CON aprobación (usuario aprueba) → escritura permitida ──
  console.log('\n=== Caso 2: usuario APRUEBA la operación fuera del workspace ===');
  setApprovalAsker(async () => 'yes');
  const okContent = `Shinobi escribió aquí tras aprobación manual — ${new Date().toISOString()}`;
  const okArgs = { path: target, content: okContent };
  const r2 = await orchestratorRun('write_file', okArgs);
  check('Shinobi pide aprobación (operación destructiva)', r2.verdict.destructive === true, r2.verdict.reason || '');
  check('usuario aprueba → operación autorizada', r2.approved === true, `approved=${r2.approved}`);
  check('el path queda registrado como aprobado manualmente',
    isPathManuallyApproved(target), `isPathManuallyApproved=${isPathManuallyApproved(target)}`);

  const okExec = await writeFileTool.execute(okArgs);
  check('write_file ejecuta con éxito tras aprobación', okExec.success === true, okExec.output || okExec.error || '');

  const created = fs.existsSync(target);
  check('archivo CREADO en el Escritorio (fuera del workspace)', created, target);
  if (created) {
    const onDisk = fs.readFileSync(target, 'utf-8');
    check('contenido en disco coincide con lo solicitado', onDisk === okContent, `${onDisk.length} bytes`);
  }

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  if (created) console.log(`(archivo de prueba dejado en ${target} como evidencia)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
