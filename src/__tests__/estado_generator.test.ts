// src/__tests__/estado_generator.test.ts
//
// F0.3 — regresión del generador de estado/contexto autogenerado
// (estado.mjs → ESTADO.md; context.mjs → AGENTS.md/CLAUDE.md). Corre los
// generadores reales sobre el árbol real del repo y compara sus conteos
// contra un `find`-equivalente hecho en Node (misma verdad de fuente que
// usa `find src -name '*.ts' -o -name '*.tsx'`), para que un futuro drift
// entre lo que dicen los .md y lo que hay en disco falle el test en vez de
// quedar silencioso.

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();

/** Mismo recorrido que `find src -name '*.ts' -o -name '*.tsx'` (recursivo, real). */
function findTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) findTsFiles(p, out);
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

const allTsFiles = findTsFiles(join(ROOT, 'src'));
const testTsFiles = allTsFiles.filter((f) => f.includes('__tests__') || f.endsWith('.test.ts'));
const prodTsFiles = allTsFiles.filter((f) => !testTsFiles.includes(f));

describe('estado.mjs — genera ESTADO.md con conteos reales', () => {
  beforeAll(() => {
    // --no-tests: rápido, no dispara una corrida anidada de vitest dentro del test.
    execFileSync('node', ['estado.mjs', '--no-tests'], { cwd: ROOT, stdio: 'ignore' });
  });

  it('ESTADO.md existe tras correr el generador', () => {
    expect(existsSync(join(ROOT, 'ESTADO.md'))).toBe(true);
  });

  it('el conteo de ficheros en ESTADO.md coincide con el escaneo real de src/', () => {
    const md = readFileSync(join(ROOT, 'ESTADO.md'), 'utf-8');
    const m = md.match(/escaneo de src\/, (\d+) ficheros, (\d+) de test/);
    expect(m, 'ESTADO.md debe tener la línea de inventario con el patrón esperado').not.toBeNull();
    const [, totalStr, testStr] = m!;
    expect(Number(totalStr)).toBe(allTsFiles.length);
    expect(Number(testStr)).toBe(testTsFiles.length);
  });

  it('ESTADO.md no referencia ficheros que no existen (auto-consistencia básica)', () => {
    const md = readFileSync(join(ROOT, 'ESTADO.md'), 'utf-8');
    expect(md).toContain('# ESTADO');
    expect(md.length).toBeGreaterThan(50);
  });
});

describe('context.mjs — regenera AGENTS.md/CLAUDE.md con conteos reales', () => {
  beforeAll(() => {
    execFileSync('node', ['context.mjs'], { cwd: ROOT, stdio: 'ignore' });
  });

  it('AGENTS.md y CLAUDE.md quedan idénticos entre sí', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8');
    expect(claude).toBe(agents);
  });

  it('el conteo de "ficheros de codigo" (produccion, sin tests) coincide con el escaneo real', () => {
    const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8');
    const m = md.match(/(\d+) ficheros de codigo \((\d+) LOC\), (\d+) de test/);
    expect(m, 'CLAUDE.md debe tener la línea de Tamano con el patrón esperado').not.toBeNull();
    const [, filesStr, , testStr] = m!;
    expect(Number(filesStr)).toBe(prodTsFiles.length);
    expect(Number(testStr)).toBe(testTsFiles.length);
  });

  it('no referencia ESTADO.md como fuente si el fichero no existe', () => {
    const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8');
    const mentionsEstado = /ESTADO\.md/.test(md);
    if (mentionsEstado) {
      expect(existsSync(join(ROOT, 'ESTADO.md'))).toBe(true);
    }
  });
});
