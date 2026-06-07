/**
 * Validación REAL del cableado P2 de usage_pattern_detector.
 * Simula 3 misiones con la MISMA secuencia de tools y comprueba que al 3er
 * registro se escribe un draft de SKILL.md real en skills/pending/.
 *
 * Run: npx tsx scripts/audit_validation/p2_usage_pattern_real.ts
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'shinobi-pattern-'));
  process.chdir(work); // el detector persiste bajo cwd/skills/
  const { recordToolPattern } = await import('../../src/skills/pattern_wiring.js');

  const seq = ['read_file', 'search_files', 'edit_file'];
  console.log('=== Simulando 3 misiones con la secuencia read_file → search_files → edit_file ===');
  const r1 = recordToolPattern(seq);
  const r2 = recordToolPattern(seq);
  console.log(`  misión 1 -> propuesta=${r1 ? 'sí' : 'no'}`);
  console.log(`  misión 2 -> propuesta=${r2 ? 'sí' : 'no'}`);
  check('no propone antes del umbral (misiones 1 y 2)', r1 === null && r2 === null, 'threshold=3');

  const r3 = recordToolPattern(seq);
  console.log(`  misión 3 -> propuesta=${r3 ? r3 : 'no'}`);
  check('propone una skill al 3er registro del mismo patrón', !!r3, 'cruzó el umbral');
  check('el draft de skill existe en disco', !!r3 && existsSync(r3), r3 ?? '(sin path)');

  if (r3 && existsSync(r3)) {
    const draft = readFileSync(r3, 'utf-8');
    console.log('\n=== Draft de SKILL.md generado ===');
    console.log(draft.split('\n').slice(0, 12).join('\n'));
    console.log('...');
    check('el draft es pending_confirmation', /status:\s*pending_confirmation/.test(draft), 'requiere revisión humana');
    check('el draft referencia la secuencia detectada',
      draft.includes('read_file') && draft.includes('edit_file'), 'menciona las tools del patrón');
  }

  // Una secuencia DISTINTA no debe proponer (cuenta independiente).
  const other = recordToolPattern(['web_search', 'clean_extract']);
  check('una secuencia distinta no se propone (cuenta aparte)', other === null, 'patrón nuevo, count=1');

  // El estado se persiste a disco.
  const persistFile = join(work, 'skills', 'usage_patterns.json');
  check('el estado del detector se persiste', existsSync(persistFile),
    existsSync(persistFile) ? `count del patrón=${JSON.parse(readFileSync(persistFile, 'utf-8')).records.find((x: any) => x.signature.includes('read_file'))?.count}` : 'no persist');

  process.chdir(tmpdir());
  try { rmSync(work, { recursive: true, force: true }); } catch {}
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
