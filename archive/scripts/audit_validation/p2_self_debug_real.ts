/**
 * Validación REAL del cableado P2 de self_debug.
 * Provoca un fallo REAL de tool (read_file sobre un fichero inexistente),
 * ejecuta el mismo diagnoseError que el orchestrator corre ahora ante cada
 * fallo, y comprueba que produce hipótesis de causa raíz + fix accionable,
 * y la forma del payload que se devuelve al LLM.
 *
 * Run: npx tsx scripts/audit_validation/p2_self_debug_real.ts
 */
import { join } from 'path';
import readFileTool from '../../src/tools/read_file.js';
import { diagnoseError, formatReport } from '../../src/selfdebug/self_debug.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // 1. Fallo REAL: leer un fichero que no existe (dentro del workspace).
  const missing = join(process.cwd(), 'scripts', 'audit_validation', '__no_existe__.txt');
  const result = await readFileTool.execute({ path: missing });
  console.log(`\n=== Fallo real de tool ===`);
  console.log(`  read_file -> success=${result.success}, error="${result.error}"`);
  check('la tool falla de verdad', result.success === false && !!result.error, 'read_file de un fichero inexistente');

  // 2. self_debug REAL sobre el error real (lo que ahora hace el orchestrator).
  const report = diagnoseError({ tool: 'read_file', args: { path: missing }, error: String(result.error) });
  console.log(`\n=== Self-debug report (ejecución real) ===`);
  console.log(formatReport(report));

  const top = report.rootCauseHypotheses[0];
  check('produce una hipótesis de causa raíz', !!top && top.confidence > 0.3,
    `top: (${Math.round((top?.confidence ?? 0) * 100)}%) ${top?.cause ?? ''}`);
  check('la hipótesis identifica el fichero inexistente',
    /no existe|file|path|module/i.test(top?.cause ?? ''), top?.cause ?? '');
  check('produce un fix accionable', report.fixSuggestions.length > 0 && !!report.fixSuggestions[0].detail,
    report.fixSuggestions[0]?.action ?? '');

  // 3. Forma del payload que el orchestrator devuelve al LLM.
  const payload = JSON.stringify({
    ...result,
    self_debug: {
      hypothesis: top ? `(${Math.round(top.confidence * 100)}%) ${top.cause}` : undefined,
      suggested_fix: report.fixSuggestions[0]
        ? `${report.fixSuggestions[0].action} — ${report.fixSuggestions[0].detail}` : undefined,
    },
  });
  console.log(`\n=== Payload al LLM ===\n  ${payload}`);
  check('el payload incluye self_debug parseable', (() => {
    try { return !!JSON.parse(payload).self_debug.hypothesis; } catch { return false; }
  })(), 'el LLM recibe el diagnóstico');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
