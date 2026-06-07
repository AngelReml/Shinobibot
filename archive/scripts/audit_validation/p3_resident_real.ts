/**
 * Validación REAL de los fixes P3 del resident loop:
 *   - withTimeout: una promesa colgada se corta; una rápida pasa.
 *   - backoff: si los ticks fallan en cadena, el intervalo CRECE (no spamea).
 *
 * Run: npx tsx scripts/audit_validation/p3_resident_real.ts
 */
import { withTimeout, ResidentLoop } from '../../src/runtime/resident_loop.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── withTimeout ───────────────────────────────────────────────────────
  console.log('\n=== P3 · withTimeout ===');
  const t0 = Date.now();
  let timedOut = false;
  try {
    await withTimeout(new Promise(() => { /* nunca resuelve */ }), 150, 'colgada');
  } catch (e: any) {
    timedOut = /timeout/.test(e?.message ?? '');
  }
  const elapsed = Date.now() - t0;
  console.log(`  promesa colgada -> rechazó tras ${elapsed}ms (timeout=${timedOut})`);
  check('withTimeout corta una promesa colgada', timedOut && elapsed < 600, 'debe rechazar ~150ms');

  const fast = await withTimeout(Promise.resolve(42), 1000, 'rápida');
  check('withTimeout deja pasar una promesa rápida', fast === 42, `resolvió ${fast}`);

  // ── backoff: ticks que fallan en cadena ───────────────────────────────
  console.log('\n=== P3 · resident loop backoff ===');
  const callTs: number[] = [];
  const stubStore: any = {
    getDueMissions: () => { callTs.push(Date.now()); throw new Error('DB corrupta (simulada)'); },
  };
  // tick base 40ms; con backoff los huecos deben crecer: ~40, ~80, ~160...
  const loop = new ResidentLoop(stubStore, { tickIntervalMs: 40 });
  loop.start();
  await sleep(1600);
  loop.stop();

  const gaps: number[] = [];
  for (let i = 1; i < callTs.length; i++) gaps.push(callTs[i] - callTs[i - 1]);
  console.log(`  ${callTs.length} ticks fallidos; huecos(ms)=[${gaps.map(g => Math.round(g)).join(', ')}]`);
  // Sin backoff, en 1600ms con intervalo 40ms habría ~40 ticks. Con backoff
  // exponencial deben ser muchos menos y los huecos crecientes.
  const grewOverall = gaps.length >= 3 && gaps[gaps.length - 1] > gaps[0];
  check('el backoff espacía los ticks fallidos', grewOverall && callTs.length < 20,
    `${callTs.length} ticks (sin backoff serían ~40); huecos crecientes=${grewOverall}`);

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
