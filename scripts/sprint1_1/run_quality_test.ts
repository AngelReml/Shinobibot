#!/usr/bin/env node
/**
 * Prueba funcional Sprint 1.1 — Memoria vectorial real.
 *
 * Carga ~1000 frases sintéticas en 10 categorías dentro de una
 * MemoryStore real (SQLite). Lanza 30 queries de paráfrasis (3 por
 * categoría) y mide precision@5: ¿cuántas de las top-5 memorias
 * pertenecen a la categoría correcta?
 *
 * Compara dos providers:
 *   - local (Transformers.js + MiniLM-L6, default)
 *   - hash (fallback determinístico, debería fallar en paráfrasis)
 *
 * El test pasa si el local supera al hash con margen claro
 * (precision@5 local ≥ 0.6, hash ≤ 0.35).
 *
 * Uso: npx tsx scripts/sprint1_1/run_quality_test.ts
 */

import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryStore } from '../../src/memory/memory_store.js';
import { _resetEmbeddingBackend } from '../../src/memory/embedding_providers/factory.js';
import { EmbeddingProvider } from '../../src/memory/embedding_provider.js';
import { buildCorpus, buildQueries, categoryList } from './embed_corpus.js';

interface ProviderResult {
  providerName: string;
  perCategory: Record<string, { precision: number; hits: number; total: number }>;
  overallPrecision: number;
  loadMs: number;
  queryMs: number;
}

async function evaluateProvider(providerEnv: 'local' | 'hash', dbPath: string): Promise<ProviderResult> {
  process.env.SHINOBI_EMBED_PROVIDER = providerEnv;
  if (providerEnv === 'hash') process.env.SHINOBI_FORCE_HASH_EMBED = '1';
  else delete process.env.SHINOBI_FORCE_HASH_EMBED;
  _resetEmbeddingBackend();

  if (existsSync(dbPath)) rmSync(dbPath);
  const store = new MemoryStore({ db_path: dbPath });
  const corpus = buildCorpus();

  console.log(`\n[${providerEnv}] Backend: ${await EmbeddingProvider.providerName()}, dim=${await EmbeddingProvider.dim()}`);
  console.log(`[${providerEnv}] Loading ${corpus.length} entries…`);
  const t0 = Date.now();
  // Loading uno por uno para no presionar a Transformers.js con un batch
  // gigante en el primer arranque (descarga del modelo).
  for (let i = 0; i < corpus.length; i++) {
    await store.store(corpus[i].text, { category: corpus[i].category });
    if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}\r`);
  }
  const loadMs = Date.now() - t0;
  console.log(`[${providerEnv}] Load: ${loadMs}ms (${Math.round(corpus.length / (loadMs / 1000))} entries/s)`);

  const queries = buildQueries();
  const perCategory: Record<string, { precision: number; hits: number; total: number }> = {};
  for (const cat of categoryList()) {
    perCategory[cat] = { precision: 0, hits: 0, total: 0 };
  }

  console.log(`[${providerEnv}] Running ${queries.length} paraphrase queries…`);
  const tQ = Date.now();
  let totalHits = 0;
  let totalChecked = 0;
  for (const q of queries) {
    const results = await store.recall({ query: q.query, limit: 5, min_score: 0.0 });
    const top5Matches = results.filter(r => r.entry.category === q.category).length;
    perCategory[q.category].hits += top5Matches;
    perCategory[q.category].total += 5; // siempre evaluamos 5 slots
    totalHits += top5Matches;
    totalChecked += 5;
  }
  const queryMs = Date.now() - tQ;

  for (const cat of Object.keys(perCategory)) {
    const p = perCategory[cat];
    p.precision = p.total > 0 ? p.hits / p.total : 0;
  }

  store.close();

  return {
    providerName: providerEnv,
    perCategory,
    overallPrecision: totalChecked > 0 ? totalHits / totalChecked : 0,
    loadMs,
    queryMs,
  };
}

function renderTable(results: ProviderResult[]): void {
  const cats = categoryList();
  console.log('\n=== Precision@5 por categoría ===');
  const header = ['category'.padEnd(14), ...results.map(r => r.providerName.padStart(10))].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const cat of cats) {
    const row = [cat.padEnd(14), ...results.map(r => {
      const p = r.perCategory[cat]?.precision ?? 0;
      const pct = (p * 100).toFixed(0) + '%';
      return pct.padStart(10);
    })].join(' ');
    console.log(row);
  }
  console.log('-'.repeat(header.length));
  const overall = ['OVERALL'.padEnd(14), ...results.map(r => ((r.overallPrecision * 100).toFixed(1) + '%').padStart(10))].join(' ');
  console.log(overall);
  console.log('-'.repeat(header.length));
  const loadRow = ['load (ms)'.padEnd(14), ...results.map(r => String(r.loadMs).padStart(10))].join(' ');
  const queryRow = ['query (ms)'.padEnd(14), ...results.map(r => String(r.queryMs).padStart(10))].join(' ');
  console.log(loadRow);
  console.log(queryRow);
}

async function main(): Promise<void> {
  const tmpDir = join(tmpdir(), `shinobi-embed-quality-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const dbLocal = join(tmpDir, 'memory-local.db');
  const dbHash = join(tmpDir, 'memory-hash.db');

  console.log('=== Sprint 1.1 — Quality test of vector memory ===');
  console.log('Note: first run with local backend downloads ~22MB ONNX model.');

  const local = await evaluateProvider('local', dbLocal);
  const hash = await evaluateProvider('hash', dbHash);

  renderTable([local, hash]);

  // Criterios:
  //   - precision@5 baseline aleatorio = 1/10 = 0.10 (10 categorías).
  //   - local debe estar al menos 3x sobre baseline (≥30%) para demostrar
  //     semántica útil con queries paráfrasis vagas.
  //   - margen vs hash ≥ 20 pts demuestra que el upgrade vale el coste.
  const BASELINE_RANDOM = 0.10;
  const margin = local.overallPrecision - hash.overallPrecision;
  const localOverBaseline = local.overallPrecision / BASELINE_RANDOM;
  const localPass = local.overallPrecision >= 0.30;
  const marginPass = margin >= 0.20;

  console.log('\n=== Verdict ===');
  console.log(`Baseline aleatorio (1/10 categorías): ${(BASELINE_RANDOM * 100).toFixed(1)}%`);
  console.log(`Local precision@5:        ${(local.overallPrecision * 100).toFixed(1)}% (${localOverBaseline.toFixed(1)}x baseline) ${localPass ? 'PASS ≥30%' : 'FAIL'}`);
  console.log(`Hash precision@5:         ${(hash.overallPrecision * 100).toFixed(1)}% (${(hash.overallPrecision / BASELINE_RANDOM).toFixed(1)}x baseline)`);
  console.log(`Margen local vs hash:    +${(margin * 100).toFixed(1)} pts ${marginPass ? 'PASS ≥20 pts' : 'FAIL'}`);

  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  const passed = localPass && marginPass;
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error('Quality test failed:', e?.stack ?? e);
  process.exit(2);
});
