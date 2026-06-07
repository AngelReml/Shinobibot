/**
 * Validación REAL de fixes P3 (lote 1):
 *   - mission_scheduler: weekday 7 (domingo) se normaliza a 0.
 *   - run_command: un SHINOBI_RUN_BACKEND desconocido NO cae a `local` en
 *     silencio (rompía el aislamiento) — devuelve error.
 *
 * Run: npx tsx scripts/audit_validation/p3_batch1_real.ts
 */
import { parseCronExpr } from '../../src/runtime/mission_scheduler.js';
import runCommandTool from '../../src/tools/run_command.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // ── mission_scheduler: weekday 7 → 0 ──────────────────────────────────
  console.log('\n=== P3 · mission_scheduler weekday 7→0 ===');
  const w7 = parseCronExpr('0 12 * * 7').weekday;
  const w0 = parseCronExpr('0 12 * * 0').weekday;
  const wMix = parseCronExpr('0 12 * * 0,7').weekday;
  console.log(`  '* * * * 7'   -> weekday=${JSON.stringify(w7)}`);
  console.log(`  '* * * * 0'   -> weekday=${JSON.stringify(w0)}`);
  console.log(`  '* * * * 0,7' -> weekday=${JSON.stringify(wMix)}`);
  check('weekday 7 se normaliza a 0',
    w7.kind === 'list' && JSON.stringify(w7.values) === '[0]', 'debe ser {list,[0]}');
  check('weekday 0,7 colapsa a [0] sin duplicado',
    wMix.kind === 'list' && JSON.stringify(wMix.values) === '[0]', 'debe ser {list,[0]}');

  // ── run_command: backend desconocido NO cae a local ───────────────────
  console.log('\n=== P3 · run_command backend desconocido ===');
  process.env.SHINOBI_RUN_BACKEND = 'backend-que-no-existe';
  const rBad = await runCommandTool.execute({ command: 'echo NO-DEBERIA-EJECUTARSE', cwd: process.cwd() });
  console.log(`  backend desconocido -> success=${rBad.success} error="${rBad.error ?? ''}"`);
  check('backend desconocido devuelve error (no ejecuta en local)',
    rBad.success === false && (rBad.error ?? '').includes('no es un backend reconocido'),
    'no debe degradar a local en silencio');
  check('NO se ejecutó el comando en local',
    !(rBad.output ?? '').includes('NO-DEBERIA-EJECUTARSE'),
    'el output no debe contener la salida del echo');

  // backend 'local' explícito SÍ ejecuta (no romper el camino normal).
  delete process.env.SHINOBI_RUN_BACKEND;
  const rOk = await runCommandTool.execute({ command: 'echo HELLO-LOCAL', cwd: process.cwd() });
  console.log(`  backend local -> success=${rOk.success} output contiene HELLO-LOCAL=${(rOk.output ?? '').includes('HELLO-LOCAL')}`);
  check('backend local sigue ejecutando normal', rOk.success && (rOk.output ?? '').includes('HELLO-LOCAL'), 'echo local debe funcionar');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
