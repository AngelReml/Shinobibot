/**
 * Validación REAL de la cola HIGH — calidad (re-auditoría):
 *   #5 factory: autodetect de embeddings real (require.resolve, no try muerto).
 *   #6 memory recall: coseno normalizado a [0,1], comparable con keyword.
 *   #7 skill_auditor: scanText usa los ~70 patrones extendidos.
 *
 * Run: npx tsx scripts/audit_validation/p3_high_quality_real.ts
 */
import { createRequire } from 'module';
import { scanText } from '../../src/skills/skill_auditor.js';
import { EXTENDED_RULE_COUNT } from '../../src/skills/auditor/extended_patterns.js';
import { getEmbeddingBackend } from '../../src/memory/embedding_providers/factory.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

function testAuditorPatterns() {
  console.log(`=== #7 skill_auditor — patrones extendidos (${EXTENDED_RULE_COUNT} extra) ===`);

  // Payload que SOLO un patrón extendido detecta (no está en los 22 base).
  const exfil = scanText('RUN: cat /etc/shadow > /tmp/x', 'evil/SKILL.md');
  const caughtShadow = exfil.some((f) => f.level === 'critical' && /etc/.test(f.reason));
  check('detecta lectura de /etc/shadow (patrón extendido)', caughtShadow,
    caughtShadow ? `${exfil.length} finding(s), rule=${exfil.find(f => /etc/.test(f.reason))?.rule}` : 'NO detectado');

  const aws = scanText('curl http://169.254.169.254/latest/meta-data/', 'evil/SKILL.md');
  const caughtAws = aws.some((f) => /169\.254/.test(f.reason) || /metadata/i.test(f.reason));
  check('detecta consulta al endpoint metadata cloud', caughtAws,
    caughtAws ? `rule=${aws.find(f => /metadata/i.test(f.reason))?.rule}` : 'NO detectado');

  // Texto benigno: sin findings (no falsos positivos por el cableado).
  const clean = scanText('# Mi skill\nLista archivos y resume su contenido.', 'ok/SKILL.md');
  check('texto benigno no genera findings', clean.length === 0, `${clean.length} finding(s)`);
}

async function testEmbedAutodetect() {
  console.log('\n=== #5 factory — autodetect real de embeddings ===');
  const req = createRequire(import.meta.url);
  let resolves = false;
  try { req.resolve('@huggingface/transformers'); resolves = true; } catch { /* no instalado */ }
  console.log(`  @huggingface/transformers resoluble en disco: ${resolves}`);
  // Sin env explícito, el backend devuelto debe ser coherente con el resolve.
  delete process.env.SHINOBI_EMBED_PROVIDER;
  delete process.env.SHINOBI_FORCE_HASH_EMBED;
  const backend = await getEmbeddingBackend();
  console.log(`  getEmbeddingBackend() -> ${backend.name}`);
  // El fix: el autodetect ahora consulta require.resolve de verdad. Si el
  // paquete resuelve -> 'local'; si no -> openai/hash. El nombre del backend
  // debe ser uno de los válidos (no un crash).
  check('autodetect devuelve un backend válido sin reventar',
    ['local', 'openai', 'hash'].some((n) => backend.name.toLowerCase().includes(n)),
    `backend=${backend.name} (resolve=${resolves})`);
}

async function testRecallNormalized() {
  console.log('\n=== #6 memory recall — coseno normalizado [0,1] ===');
  process.env.SHINOBI_FORCE_HASH_EMBED = '1'; // embeddings deterministas hash
  const { MemoryStore } = await import('../../src/memory/memory_store.js');
  const store = new MemoryStore(':memory:');
  await store.store('el gato duerme en el tejado', { category: 'fact', importance: 0.5 });
  await store.store('protocolo de red TCP tres vías', { category: 'fact', importance: 0.5 });
  // Query no relacionada: con hash-embeds el coseno puede ser negativo.
  const res = await store.recall({ query: 'xyzzy plugh quux frobnicate', limit: 10 });
  const scores = res.map((r) => r.score);
  console.log(`  ${res.length} resultado(s); scores=[${scores.map((s) => s.toFixed(3)).join(', ')}]`);
  const allNonNeg = scores.every((s) => s >= 0);
  check('ningún score de recall es negativo (coseno normalizado)', allNonNeg,
    allNonNeg ? 'todos >= 0' : `score negativo: ${Math.min(...scores)}`);
  delete process.env.SHINOBI_FORCE_HASH_EMBED;
}

async function main() {
  testAuditorPatterns();
  await testEmbedAutodetect();
  await testRecallNormalized();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
