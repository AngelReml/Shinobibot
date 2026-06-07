/**
 * Validación REAL de los 4 MEDIUM con superficie real del 4º ciclo:
 *   #A install_update — no ejecuta el instalador sin sha256 verificable.
 *   #B memory_store    — una memoria que no matchea NO entra al ranking.
 *   #C sharedMemory    — instancia única → la cadena C7 se comparte.
 *   #D .gitignore      — .shinobi-reader-cache/ ignorado.
 *
 * Run: npx tsx scripts/audit_validation/p4_medium_real.ts
 */
import { createServer } from 'http';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runUpdate } from '../../src/updater/install_update.js';
import { MemoryStore } from '../../src/memory/memory_store.js';
import { sharedMemory } from '../../src/db/memory.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function testInstallUpdate() {
  console.log('=== #A install_update — sin sha256 no se ejecuta ===');
  const body = Buffer.from('FAKE-INSTALLER-PAYLOAD-' + Date.now());
  const realHash = createHash('sha256').update(body).digest('hex');
  const server = createServer((_req, res) => { res.writeHead(200); res.end(body); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/setup.exe`;

  const baseOffer = { current: '1.0.0', latest: '9.9.9', download_url: url, released_at: '2026-05-17', channel: 'stable' };
  try {
    // A1 — manifest SIN sha256, dryRun=false: debe rehusar (no spawnea).
    const noHash = await runUpdate({ ...baseOffer }, { dryRun: false });
    console.log(`  sin sha256 -> ${JSON.stringify(noHash)}`);
    check('un instalador sin sha256 NO se ejecuta', !noHash.ok && /sha256/i.test(noHash.reason ?? ''),
      `ok=${noHash.ok}, reason="${noHash.reason}"`);

    // A2 — manifest con sha256 correcto, dryRun=true: verifica y no ejecuta.
    const okHash = await runUpdate({ ...baseOffer, sha256: realHash }, { dryRun: true });
    check('sha256 correcto pasa la verificación', okHash.ok && okHash.sha256_ok === true,
      `ok=${okHash.ok}, sha256_ok=${okHash.sha256_ok}`);

    // A3 — sha256 manipulado: rechazado.
    const badHash = await runUpdate({ ...baseOffer, sha256: 'deadbeef'.repeat(8) }, { dryRun: true });
    check('sha256 manipulado se rechaza', !badHash.ok && /mismatch/i.test(badHash.reason ?? ''),
      `reason="${badHash.reason}"`);
  } finally {
    server.close();
  }
}

async function testMemoryRanking() {
  console.log('\n=== #B memory_store — no-match no entra al ranking ===');
  process.env.SHINOBI_FORCE_HASH_EMBED = '1';
  const dbFile = join(mkdtempSync(join(tmpdir(), 'shinobi-mem-')), 'memory.db');
  const store = new MemoryStore({ db_path: dbFile });
  await store.store('apuntes sobre fotosíntesis y cloroplastos', { category: 'fact', importance: 0.9 });

  // Simula una memoria SIN embedding compatible (provider antiguo / cambio
  // de modelo): se anula el embedding en disco.
  const raw = new Database(dbFile);
  raw.prepare('UPDATE memories SET embedding = NULL').run();
  raw.close();

  const store2 = new MemoryStore({ db_path: dbFile });
  // Query totalmente ajena al contenido, sin tags, min_score 0.
  const miss = await store2.recall({ query: 'xyzzy plugh frobnicate', limit: 10, min_score: 0 });
  console.log(`  recall(query ajena, embedding NULL) -> ${miss.length} resultado(s)`);
  check('una memoria que no matchea por nada NO se devuelve', miss.length === 0,
    miss.length === 0 ? 'ranking vacío (correcto)' : `devolvió ${miss.length} irrelevante(s)`);

  // Contraste: keyword match sí funciona aunque no haya embedding.
  const hit = await store2.recall({ query: 'fotosíntesis', limit: 10, min_score: 0 });
  check('un keyword match sí se devuelve (sin embedding)', hit.length === 1,
    `${hit.length} resultado(s), matchType=${hit[0]?.match_type}`);
  delete process.env.SHINOBI_FORCE_HASH_EMBED;
}

async function testSharedMemory() {
  console.log('\n=== #C sharedMemory — instancia única, cadena C7 compartida ===');
  const a = sharedMemory();
  const b = sharedMemory();
  check('sharedMemory() devuelve la MISMA instancia', a === b, a === b ? 'singleton' : 'instancias distintas');

  // 15 addMessage concurrentes sobre la instancia compartida: sin lost-update.
  const file = join(mkdtempSync(join(tmpdir(), 'shinobi-sm-')), 'memory.json');
  const m = sharedMemory(file);
  const N = 15;
  await Promise.all(
    Array.from({ length: N }, (_, i) => m.addMessage({ role: 'user', content: `mensaje concurrente #${i}` })),
  );
  const msgs = await m.getMessages();
  console.log(`  ${N} addMessage concurrentes -> ${msgs.length} persistidos`);
  check('15 escrituras concurrentes en la instancia compartida no se pisan', msgs.length === N,
    `${msgs.length}/${N} persistidos`);
}

function testGitignore() {
  console.log('\n=== #D .gitignore — .shinobi-reader-cache/ ===');
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', 'src/.shinobi-reader-cache/']);
    ignored = true;
  } catch { ignored = false; }
  check('.shinobi-reader-cache/ está gitignoreado', ignored, ignored ? 'git lo ignora' : 'NO ignorado');
}

async function main() {
  await testInstallUpdate();
  await testMemoryRanking();
  await testSharedMemory();
  testGitignore();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
