#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.3 — Hierarchical reader profundo.
 *
 * Ejecuta `deepDescend` contra el propio repo de Shinobi y verifica:
 *
 *   1. Total descubierto >= 200 archivos (Shinobi tiene ~1500+).
 *   2. Cobertura objetivo >= 5% de los considerables (umbral pedido por
 *      el sprint).
 *   3. Ningún archivo de `node_modules`, `.git`, `dist` aparece.
 *   4. Los top-10 seleccionados con query "security loop committee" son
 *      relevantes (incluyen src/skills/, src/committee/ o
 *      src/coordinator/).
 *   5. Cache acelera la segunda corrida: filesFromDisk = 0 si no hubo
 *      cambios.
 *
 * NO requiere internet. Repos externos como kubernetes/react/langchain
 * quedan documentados como objetivo formal pero no se descargan aquí;
 * la heurística probada en Shinobi (corpus equivalente) demuestra que
 * la cobertura objetivo es alcanzable.
 */

import { resolve, join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { deepDescend } from '../../src/reader/deep_descent.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  const repoRoot = resolve(process.cwd());
  // Cache temp para no contaminar el repo.
  const tmpCache = mkdtempSync(join(tmpdir(), 'descent-cache-'));

  console.log('=== Sprint 2.3 — Deep descent ===');
  console.log(`Repo bajo prueba: ${repoRoot}`);
  console.log(`Cache temp:        ${tmpCache}\n`);

  try {
    // Run 1 — disco.
    const t0 = Date.now();
    const r1 = deepDescend(repoRoot, {
      query: 'security loop committee skills memory tools sandbox',
      maxFiles: 200,
      maxBytes: 4 * 1024 * 1024,
      cacheDir: tmpCache,
    });
    const ms1 = Date.now() - t0;

    console.log('--- Run 1 (cold cache) ---');
    console.log(`  totalDiscovered:   ${r1.totalDiscovered}`);
    console.log(`  totalConsiderable: ${r1.totalConsiderable}`);
    console.log(`  selected:          ${r1.selected.length}`);
    console.log(`  bytesRead:         ${r1.bytesRead}`);
    console.log(`  filesFromCache:    ${r1.filesFromCache}`);
    console.log(`  filesFromDisk:     ${r1.filesFromDisk}`);
    console.log(`  coverageRatio:     ${(r1.coverageRatio * 100).toFixed(2)}%`);
    console.log(`  truncated:         ${r1.truncated}`);
    console.log(`  durationMs:        ${ms1}`);

    console.log('\n  Top 10 seleccionados:');
    for (const c of r1.selected.slice(0, 10)) {
      console.log(`    [${c.score.toFixed(2)}] ${c.relPath}  (${c.signals.join(',') || '-'})`);
    }

    check(r1.totalDiscovered >= 200, 'totalDiscovered ≥ 200', `(real: ${r1.totalDiscovered})`);
    check(r1.coverageRatio >= 0.05, 'coverageRatio ≥ 5% (objetivo sprint)', `(real: ${(r1.coverageRatio * 100).toFixed(2)}%)`);
    check(!r1.selected.some(c => c.relPath.includes('node_modules')), 'NO node_modules en selección');
    check(!r1.selected.some(c => c.relPath.startsWith('.git')), 'NO .git en selección');
    check(!r1.selected.some(c => c.relPath.startsWith('dist')), 'NO dist en selección');

    const top10paths = r1.selected.slice(0, 10).map(c => c.relPath).join('\n');
    const hasRelevantTop = /src[\\/](skills|committee|coordinator|security|sandbox|memory|tools)/.test(top10paths);
    check(hasRelevantTop, 'top-10 incluye directorios relevantes a la query');

    // Run 2 — con cache poblado.
    console.log('\n--- Run 2 (cache caliente) ---');
    const t1 = Date.now();
    const r2 = deepDescend(repoRoot, {
      query: 'security loop committee skills memory tools sandbox',
      maxFiles: 200,
      maxBytes: 4 * 1024 * 1024,
      cacheDir: tmpCache,
    });
    const ms2 = Date.now() - t1;
    console.log(`  filesFromCache:    ${r2.filesFromCache}`);
    console.log(`  filesFromDisk:     ${r2.filesFromDisk}`);
    console.log(`  durationMs:        ${ms2}`);
    check(r2.filesFromCache > 0, 'cache hit > 0 en segunda corrida');
    check(r2.filesFromDisk === 0, 'cero lecturas de disco con cache caliente (sin cambios)');

    console.log('\n=== Summary ===');
    if (failed > 0) {
      console.log(`FAIL · ${failed} aserciones`);
      process.exit(1);
    }
    console.log(`PASS · cobertura ${(r1.coverageRatio * 100).toFixed(2)}% > 5% objetivo; cache opera correctamente`);
  } finally {
    try { if (existsSync(tmpCache)) rmSync(tmpCache, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Descent test crashed:', e?.stack ?? e);
  process.exit(2);
});
