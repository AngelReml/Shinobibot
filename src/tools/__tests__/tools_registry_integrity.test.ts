// F0.5 — tools-fantasma: todo archivo importado por src/tools/index.ts
// (side-effect imports './xxx.js') debe llamar registerTool() al menos una
// vez en su código fuente. Detecta futuros archivos que se importen "por si
// acaso" y queden como código muerto que compila pero no aporta ninguna
// tool activa (como pasó con browser_click.ts/browser_scroll.ts/
// browser_click_position.ts antes de este fix).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TOOLS_DIR = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(TOOLS_DIR, 'index.ts');

function localSideEffectImports(sourcePath: string): string[] {
  const src = fs.readFileSync(sourcePath, 'utf-8');
  const names: string[] = [];
  const re = /^import\s+'\.\/([A-Za-z0-9_-]+)\.js';/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

describe('F0.5 — tools/index.ts no importa nada que no registre una tool', () => {
  const names = localSideEffectImports(INDEX_PATH);

  it('encuentra al menos las tools esperadas (sanity check de que el parser funciona)', () => {
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain('read_file');
    expect(names).toContain('run_command');
  });

  it('cada archivo importado llama registerTool() al menos una vez, o es un stub explícito documentado', () => {
    const offenders: string[] = [];
    for (const name of names) {
      const filePath = path.join(TOOLS_DIR, `${name}.ts`);
      if (!fs.existsSync(filePath)) continue; // .js resuelto a otra ext — no aplica aquí
      const content = fs.readFileSync(filePath, 'utf-8');
      const hasRegisterCall = /registerTool\s*\(/.test(content);
      const isDocumentedStub = /EXTIRPADO/.test(content) && /export\s*\{\s*\}/.test(content);
      if (!hasRegisterCall && !isDocumentedStub) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
