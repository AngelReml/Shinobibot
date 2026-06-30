// src/reader/__tests__/repo_map.test.ts
// G4-3 — Tests del RepoMap: índice símbolo→archivo + retrieval BM25.
// Todos son deterministas, sin red, sin LLM.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildRepoMap, searchRepoMap, formatSearchResults } from '../repo_map.js';

// ── Fixture en tmp ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-test-'));

  // Simula un mini-repo con 4 archivos.
  fs.mkdirSync(path.join(tmpDir, 'utils'));
  fs.mkdirSync(path.join(tmpDir, 'core'));

  fs.writeFileSync(path.join(tmpDir, 'utils', 'math.js'),
    'function average(nums) {\n' +
    '  const total = nums.reduce((a,b) => a+b, 0);\n' +
    '  return total / nums.total; // BUG: debería ser nums.length\n' +
    '}\n' +
    'function median(nums) { return nums[Math.floor(nums.length/2)]; }\n' +
    'module.exports = { average, median };\n');

  fs.writeFileSync(path.join(tmpDir, 'utils', 'string.js'),
    'function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }\n' +
    'function truncate(s, n) { return s.length > n ? s.slice(0,n) + "…" : s; }\n' +
    'module.exports = { capitalize, truncate };\n');

  fs.writeFileSync(path.join(tmpDir, 'core', 'auth.js'),
    'function hashPassword(pw) { return pw.split("").reverse().join(""); }\n' +
    'function validateToken(token) { return token && token.length > 10; }\n' +
    'module.exports = { hashPassword, validateToken };\n');

  fs.writeFileSync(path.join(tmpDir, 'core', 'user.js'),
    'const { hashPassword } = require("../utils/string");\n' +
    'class UserService {\n' +
    '  constructor(db) { this.db = db; }\n' +
    '  async createUser(name, password) {\n' +
    '    return { name, hash: hashPassword(password) };\n' +
    '  }\n' +
    '  async getUser(id) { return this.db.find(id); }\n' +
    '}\n' +
    'module.exports = { UserService };\n');

  // Ignora node_modules.
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {}');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RepoMap', () => {

  it('buildRepoMap indexa los archivos .js e ignora node_modules', () => {
    const map = buildRepoMap(tmpDir);
    const paths = map.files.map(f => f.relPath.replace(/\\/g, '/'));
    expect(paths).toContain('utils/math.js');
    expect(paths).toContain('utils/string.js');
    expect(paths).toContain('core/auth.js');
    expect(paths).toContain('core/user.js');
    // node_modules ignorado.
    expect(paths.every(p => !p.includes('node_modules'))).toBe(true);
    expect(map.files.length).toBe(4);
  });

  it('buildRepoMap extrae símbolos de los archivos', () => {
    const map = buildRepoMap(tmpDir);
    const math = map.files.find(f => f.relPath.replace(/\\/g, '/') === 'utils/math.js')!;
    expect(math).toBeDefined();
    const names = math.symbols.map(s => s.name);
    expect(names).toContain('average');
    expect(names).toContain('median');
  });

  it('buildRepoMap calcula IDF (términos raros tienen IDF mayor)', () => {
    const map = buildRepoMap(tmpDir);
    // "average" aparece solo en math.js → IDF alto.
    // "module" aparece en todos → IDF bajo.
    const idfAverage = map.idf.get('average') ?? 0;
    const idfModule = map.idf.get('module') ?? 0;
    // average debería tener mayor IDF que module (que aparece en todos los files)
    expect(idfAverage).toBeGreaterThan(0);
    // Si module aparece en todos los files, su IDF es el mínimo
    // average aparece en 1/4 files, module en ~4/4 files
    expect(idfAverage).toBeGreaterThanOrEqual(idfModule);
  });

  it('searchRepoMap rankea math.js primero para query sobre average bug', () => {
    const map = buildRepoMap(tmpDir);
    const results = searchRepoMap(map, 'bug in average function divide by length', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relPath.replace(/\\/g, '/')).toBe('utils/math.js');
    expect(results[0].matchedSymbols).toContain('average');
  });

  it('searchRepoMap rankea auth.js o user.js para query sobre password hash', () => {
    const map = buildRepoMap(tmpDir);
    const results = searchRepoMap(map, 'hash password authentication token', 5);
    expect(results.length).toBeGreaterThan(0);
    const topPaths = results.slice(0, 2).map(r => r.relPath.replace(/\\/g, '/'));
    expect(topPaths.some(p => p.includes('auth') || p.includes('user'))).toBe(true);
  });

  it('searchRepoMap devuelve snippet con líneas de contexto', () => {
    const map = buildRepoMap(tmpDir);
    const results = searchRepoMap(map, 'average nums total', 3);
    expect(results[0]?.snippet.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('average');
  });

  it('searchRepoMap devuelve array vacío para query sin match', () => {
    const map = buildRepoMap(tmpDir);
    const results = searchRepoMap(map, 'blockchain quantum nft metaverse', 5);
    expect(results).toHaveLength(0);
  });

  it('formatSearchResults produce texto legible para el LLM', () => {
    const map = buildRepoMap(tmpDir);
    const results = searchRepoMap(map, 'average calculate stats', 3);
    const text = formatSearchResults(results, 'average calculate stats');
    expect(text).toContain('RepoMap');
    expect(text).toContain('utils/math.js');
    expect(text).toContain('score=');
  });

  it('buildRepoMap en directorio vacío no lanza error', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-empty-'));
    try {
      const map = buildRepoMap(emptyDir);
      expect(map.files).toHaveLength(0);
      const results = searchRepoMap(map, 'anything', 3);
      expect(results).toHaveLength(0);
    } finally {
      fs.rmdirSync(emptyDir);
    }
  });
});
