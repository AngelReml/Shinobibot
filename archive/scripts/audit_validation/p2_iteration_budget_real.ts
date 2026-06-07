/**
 * Validación REAL del cableado P2 de iteration_budget.
 * El orchestrator ahora corre `while (budget.consume())` con un
 * IterationBudget en vez de `maxIterations = 10` hardcodeado.
 * Aquí se ejercita el IterationBudget real (el mecanismo que controla el
 * loop) y se demuestra que el patrón `while(consume())` termina al agotarse.
 *
 * Run: npx tsx scripts/audit_validation/p2_iteration_budget_real.ts
 */
import { IterationBudget, withBudget } from '../../src/coordinator/iteration_budget.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // 1. consume() limita exactamente al total.
  const b = new IterationBudget(3);
  const results = [b.consume(), b.consume(), b.consume(), b.consume()];
  console.log(`=== IterationBudget(3): consume x4 -> [${results.join(', ')}] ===`);
  check('consume permite exactamente `total` turnos', JSON.stringify(results) === '[true,true,true,false]',
    `[${results}]`);
  const snap = b.snapshot();
  console.log(`  snapshot: ${JSON.stringify(snap)}`);
  check('snapshot.used no excede total', snap.used === 3 && snap.remaining === 0, `used=${snap.used}`);

  // 2. El patrón exacto del orchestrator: `while (budget.consume())`.
  const loopBudget = new IterationBudget(Number(process.env.SHINOBI_MAX_ITERATIONS) || 10);
  let iters = 0;
  while (loopBudget.consume()) iters++;
  console.log(`\n=== Patrón del orchestrator: while(budget.consume()) -> ${iters} iteraciones ===`);
  check('el loop termina exactamente al agotar el presupuesto', iters === 10, `${iters} iteraciones (cap 10)`);

  // 3. Configurable por env (el orchestrator lee SHINOBI_MAX_ITERATIONS).
  process.env.SHINOBI_MAX_ITERATIONS = '4';
  const cfgBudget = new IterationBudget(Number(process.env.SHINOBI_MAX_ITERATIONS) || 10);
  let cfgIters = 0;
  while (cfgBudget.consume()) cfgIters++;
  console.log(`  con SHINOBI_MAX_ITERATIONS=4 -> ${cfgIters} iteraciones`);
  check('el cap es configurable por env', cfgIters === 4, `${cfgIters}`);

  // 4. withBudget helper.
  const wb = await withBudget(2, async (bud) => {
    let n = 0; while (bud.consume()) n++; return n;
  });
  check('withBudget ejecuta con presupuesto descartable', wb.result === 2 && wb.budget.used === 2,
    `result=${wb.result}, used=${wb.budget.used}`);

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
