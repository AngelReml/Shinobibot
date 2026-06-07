/**
 * Validación REAL — Bucle de aprendizaje, Fase 3 (separación de stores).
 *   - classifyMemoryEntry: declarativo pasa, imperativo se rechaza.
 *   - runBackgroundReview descarta las entradas imperativas: solo el hecho
 *     declarativo llega a MEMORY.md.
 *
 * Run: npx tsx scripts/audit_validation/learning_phase3_real.ts
 */
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = mkdtempSync(join(tmpdir(), 'shinobi-learn3-'));
process.chdir(TMP);

const { classifyMemoryEntry } = await import('../../src/learning/memory_separation.js');
const { runBackgroundReview } = await import('../../src/learning/background_review.js');
const { curatedMemory } = await import('../../src/memory/curated_memory.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const cloud = (text: string) => ({ success: true, output: JSON.stringify({ content: text }), error: '' });

function testClassifier() {
  console.log('=== classifyMemoryEntry — declarativo vs imperativo ===');
  const decl = [
    'el usuario prefiere respuestas concisas y directas',
    "the user's timezone is CET",
    'el usuario trabaja en un proyecto TypeScript llamado Shinobi',
  ];
  const imp = [
    'Always respond concisely',
    'Never use long explanations',
    'Siempre responde en español',
    'Nunca uses emojis',
    'no uses respuestas largas',
  ];
  const declOk = decl.every((t) => classifyMemoryEntry(t).ok === true);
  const impRej = imp.every((t) => classifyMemoryEntry(t).ok === false);
  check('los hechos declarativos se aceptan', declOk, `${decl.length}/${decl.length} aceptados`);
  check('las entradas imperativas se rechazan', impRej, `${imp.length}/${imp.length} rechazadas`);
  const sample = classifyMemoryEntry('Always be brief');
  check('el rechazo trae un motivo accionable', !sample.ok && !!sample.reason, sample.reason ?? '');
}

async function testReviewFilters() {
  console.log('\n=== runBackgroundReview descarta lo imperativo ===');
  curatedMemory().loadAtBoot();
  // Decisión con 1 hecho declarativo + 2 entradas imperativas.
  const decision = {
    memory: [
      { content: 'el usuario prefiere que le confirmes antes de borrar archivos' },
      { content: 'Always ask before deleting' },
      { content: 'Nunca borres sin preguntar' },
    ],
    skills: [],
    note: 'mezcla declarativo/imperativo',
  };
  const r = await runBackgroundReview({
    history: [{ role: 'user', content: 'confírmame antes de borrar' }],
    reviewMemory: true, reviewSkills: false,
    invoker: (async () => cloud(JSON.stringify(decision))) as any,
  });
  console.log(`  resultado: ${JSON.stringify(r)}`);
  check('solo el hecho declarativo entra a memoria (2 imperativos descartados)',
    r.ok && r.memorySaved === 1, `memorySaved=${r.memorySaved} (esperado 1 de 3)`);
  const mem = curatedMemory().showMemory();
  check('MEMORY.md tiene el hecho declarativo', /confirmes antes de borrar/.test(mem), 'declarativo presente');
  check('MEMORY.md NO tiene la directiva imperativa', !/Always ask before deleting/.test(mem), 'imperativo ausente');
}

async function main() {
  testClassifier();
  await testReviewFilters();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
