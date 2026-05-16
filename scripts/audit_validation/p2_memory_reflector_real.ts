/**
 * Validación REAL del cableado P2 de memory_reflector.
 * Ejecuta el reflector real sobre una conversación con una contradicción y
 * una preferencia, y comprueba el reporte markdown escrito a disco. También
 * verifica el disparo periódico (noteMessage / shouldReflect).
 *
 * Run: npx tsx scripts/audit_validation/p2_memory_reflector_real.ts
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryReflector } from '../../src/context/memory_reflector.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'shinobi-reflect-'));
  const reflector = new MemoryReflector({ reflectionDir: dir, intervalMessages: 3 });

  // Historia con una contradicción (mismo topic, valores distintos) y una
  // preferencia explícita.
  const history = [
    { role: 'user' as const, content: 'mi config está en /etc/shinobi/a.conf' },
    { role: 'assistant' as const, content: 'anotado' },
    { role: 'user' as const, content: 'me gusta typescript para todo el proyecto' },
    { role: 'assistant' as const, content: 'ok' },
    { role: 'user' as const, content: 'mi config está en /etc/shinobi/b.conf' },
  ];

  console.log('=== analyze() real sobre la conversación ===');
  const report = reflector.analyze(history);
  console.log(`  contradicciones=${report.contradictions.length}, preferencias=${report.preferences.length}`);
  for (const c of report.contradictions) console.log(`  contradicción: topic="${c.topic}"`);
  for (const p of report.preferences) console.log(`  preferencia: [${p.kind}] "${p.subject}"`);
  check('detecta la contradicción de config', report.contradictions.some(c => c.topic.includes('config')),
    `${report.contradictions.length} contradicciones`);
  check('detecta la preferencia (typescript)', report.preferences.some(p => p.kind === 'like' && /typescript/i.test(p.subject)),
    `${report.preferences.length} preferencias`);
  check('escribió el reporte markdown a disco', !!report.filePath && existsSync(report.filePath), report.filePath ?? '');

  if (report.filePath && existsSync(report.filePath)) {
    const md = readFileSync(report.filePath, 'utf-8');
    console.log('\n=== Reporte markdown (extracto) ===');
    console.log(md.split('\n').slice(0, 10).join('\n'));
    check('el markdown contiene las secciones esperadas',
      md.includes('Contradicciones') && md.includes('Preferencias'), 'reporte auditable');
  }

  // Disparo periódico.
  console.log('\n=== noteMessage / shouldReflect (intervalo 3) ===');
  const r = new MemoryReflector({ reflectionDir: dir, intervalMessages: 3 });
  const fires: boolean[] = [];
  for (let i = 0; i < 6; i++) { r.noteMessage(); fires.push(r.shouldReflect()); }
  console.log(`  disparos por mensaje 1..6: [${fires.join(', ')}]`);
  check('shouldReflect dispara cada 3 mensajes',
    JSON.stringify(fires) === '[false,false,true,false,false,true]', `[${fires}]`);

  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
