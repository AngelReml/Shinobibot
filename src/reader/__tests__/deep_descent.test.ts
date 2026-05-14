import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverAndScore, deepDescend } from '../deep_descent.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'shinobi-descent-'));
});
afterEach(() => {
  try { if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true }); } catch {}
});

function writeFile(rel: string, content: string): void {
  const abs = join(workspace, rel);
  const dir = abs.slice(0, abs.lastIndexOf('/') !== -1 ? abs.lastIndexOf('/') : abs.lastIndexOf('\\'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function buildSyntheticRepo(): void {
  // 50 archivos en varias categorías.
  writeFile('README.md', '# Synthetic repo for test');
  writeFile('package.json', '{}');
  writeFile('src/index.ts', 'console.log("entry")');
  writeFile('src/coordinator/orchestrator.ts', '// orchestrator main loop');
  writeFile('src/coordinator/loop_detector.ts', '// loop detection');
  writeFile('src/tools/run_command.ts', '// run command tool');
  writeFile('src/tools/read_file.ts', '// read file tool');
  writeFile('src/tools/write_file.ts', '// write file tool');
  writeFile('src/security/permissions.ts', '// security check');
  writeFile('src/security/blacklist.ts', '// destructive blacklist');
  writeFile('src/memory/store.ts', '// memory store');
  writeFile('src/memory/embeddings.ts', '// embeddings');
  for (let i = 0; i < 15; i++) writeFile(`src/utils/util_${i}.ts`, '// util ' + i);
  for (let i = 0; i < 10; i++) writeFile(`docs/note_${i}.md`, '# note ' + i);
  for (let i = 0; i < 5; i++) writeFile(`tests/test_${i}.spec.ts`, '// test ' + i);
  // Cosas que deben ser excluidas o skipeadas
  mkdirSync(join(workspace, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(workspace, 'node_modules', 'dep', 'index.js'), 'console.log()');
  writeFileSync(join(workspace, 'logo.png'), 'binary-content');
  // Archivo enorme (skip hard).
  writeFileSync(join(workspace, 'large.txt'), 'x'.repeat(2 * 1024 * 1024));
}

describe('discoverAndScore', () => {
  it('descubre archivos y excluye node_modules', () => {
    buildSyntheticRepo();
    const r = discoverAndScore(workspace, { query: 'security and tools' });
    expect(r.totalDiscovered).toBeGreaterThan(30);
    // node_modules excluido.
    expect(r.candidates.some(c => c.relPath.includes('node_modules'))).toBe(false);
    // Archivos binarios excluidos.
    expect(r.candidates.some(c => c.relPath.endsWith('.png'))).toBe(false);
    // Archivos gigantes excluidos.
    expect(r.candidates.some(c => c.relPath === 'large.txt')).toBe(false);
  });

  it('asigna scores y ordena descendente', () => {
    buildSyntheticRepo();
    const r = discoverAndScore(workspace, { query: 'security command tool' });
    for (let i = 1; i < r.candidates.length; i++) {
      expect(r.candidates[i - 1].score).toBeGreaterThanOrEqual(r.candidates[i].score);
    }
  });

  it('keywords de la query suben score de archivos relevantes', () => {
    buildSyntheticRepo();
    const r = discoverAndScore(workspace, { query: 'orchestrator loop detector' });
    const top3 = r.candidates.slice(0, 3).map(c => c.relPath);
    expect(top3.some(p => /orchestrator|loop_detector/.test(p))).toBe(true);
  });

  it('signals incluye etiquetas legibles', () => {
    buildSyntheticRepo();
    const r = discoverAndScore(workspace, { query: 'security tool' });
    const withSig = r.candidates.find(c => c.signals.length > 0);
    expect(withSig).toBeTruthy();
  });
});

describe('deepDescend — cobertura y budget', () => {
  it('respecta maxFiles', () => {
    buildSyntheticRepo();
    const r = deepDescend(workspace, { query: 'src', maxFiles: 10 });
    expect(r.selected.length).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it('respecta maxBytes', () => {
    buildSyntheticRepo();
    const r = deepDescend(workspace, { query: 'all', maxFiles: 1000, maxBytes: 200 });
    // Cada archivo es pequeño, pero la suma debe respetarse.
    expect(r.bytesRead).toBeLessThanOrEqual(200 + 256); // tolerance
    expect(r.truncated).toBe(true);
  });

  it('cobertura > 50% en repo sintético cuando budget alcanza', () => {
    buildSyntheticRepo();
    const r = deepDescend(workspace, { query: 'security tool memory', maxFiles: 500, maxBytes: 4 * 1024 * 1024 });
    expect(r.coverageRatio).toBeGreaterThan(0.5);
    expect(r.selected.length).toBeGreaterThan(20);
  });

  it('cache hit en segunda corrida', () => {
    buildSyntheticRepo();
    const cacheDir = join(workspace, '.cache');
    const r1 = deepDescend(workspace, { query: 'security', cacheDir });
    expect(r1.filesFromCache).toBe(0);
    expect(r1.filesFromDisk).toBeGreaterThan(0);
    const r2 = deepDescend(workspace, { query: 'security', cacheDir });
    expect(r2.filesFromCache).toBeGreaterThan(0);
    expect(r2.filesFromDisk).toBe(0);
  });

  it('ignoreCache fuerza re-lectura', () => {
    buildSyntheticRepo();
    const cacheDir = join(workspace, '.cache');
    deepDescend(workspace, { query: 'security', cacheDir });
    const r = deepDescend(workspace, { query: 'security', cacheDir, ignoreCache: true });
    expect(r.filesFromDisk).toBeGreaterThan(0);
    expect(r.filesFromCache).toBe(0);
  });

  it('rootDir inexistente → totales 0 sin lanzar', () => {
    const r = deepDescend(join(workspace, 'nope'), { query: 'x' });
    expect(r.totalDiscovered).toBe(0);
    expect(r.selected.length).toBe(0);
  });
});
