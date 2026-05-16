/**
 * Validación REAL P2: los backends modal/daytona son stubs HONESTOS.
 * Antes: isConfigured() devolvía true con tokens y run() fingía trabajo
 * (echo MODAL_NOT_IMPLEMENTED) -> un operador creía aislar ejecución.
 * Ahora: isConfigured()=false siempre y run() devuelve un error claro.
 *
 * Run: npx tsx scripts/audit_validation/p2_modal_daytona_real.ts
 */
import { ModalBackend } from '../../src/sandbox/backends/modal.js';
import { DaytonaBackend } from '../../src/sandbox/backends/daytona.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // Simula tokens presentes — antes esto hacía isConfigured() devolver true.
  process.env.MODAL_TOKEN_ID = 'fake';
  process.env.MODAL_TOKEN_SECRET = 'fake';
  process.env.DAYTONA_API_KEY = 'fake';

  for (const [name, backend] of [['modal', new ModalBackend()], ['daytona', new DaytonaBackend()]] as const) {
    console.log(`\n=== ${name} ===`);
    const configured = backend.isConfigured();
    console.log(`  isConfigured() = ${configured} (con tokens fake en env)`);
    check(`${name}: isConfigured() es false aunque haya tokens`, configured === false,
      'no se presenta como backend usable');

    const r = await backend.run({ command: 'echo hola', cwd: process.cwd(), timeoutMs: 5000 });
    console.log(`  run() -> success=${r.success}, exitCode=${r.exitCode}`);
    console.log(`  stderr: ${r.stderr.slice(0, 120)}`);
    check(`${name}: run() falla honestamente`, r.success === false, 'no finge trabajo');
    check(`${name}: run() declara que es un stub`, /stub no funcional/i.test(r.stderr),
      'el mensaje dice claramente que es un stub');
  }

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
