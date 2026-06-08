// src/lsp/__tests__/diagnostics.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDiagnostics, formatDiagnostics } from '../diagnostics.js';
import lintFileTool from '../../tools/lint_file.js';
import writeFileTool from '../../tools/write_file.js';

describe('runDiagnostics', () => {
  it('TS válido → sin diagnósticos', async () => {
    expect(await runDiagnostics('x.ts', 'const a: number = 1;\n')).toEqual([]);
  });

  it('TS con error de sintaxis → diagnóstico con posición y código TS', async () => {
    const diags = await runDiagnostics('x.ts', 'const a: number = ;\n');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].line).toBe(1);
    expect(diags[0].severity).toBe('error');
    expect(String(diags[0].code)).toMatch(/^TS/);
  });

  it('JSON válido → []; JSON inválido → diagnóstico', async () => {
    expect(await runDiagnostics('c.json', '{"a": 1}')).toEqual([]);
    const diags = await runDiagnostics('c.json', '{"a": }');
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('JSON');
  });

  it('extensión sin checker → []', async () => {
    expect(await runDiagnostics('readme.md', '# hola')).toEqual([]);
  });
});

describe('formatDiagnostics', () => {
  it('formatea o devuelve vacío', () => {
    expect(formatDiagnostics([])).toBe('');
    const f = formatDiagnostics([{ line: 3, column: 5, severity: 'error', message: 'malo', code: 'TS1' }]);
    expect(f).toMatch(/Diagnósticos \(1\)/);
    expect(f).toMatch(/3:5/);
  });
});

describe('lint_file (tool) y opt-in en write_file', () => {
  let dir: string;
  let prevWs: string | undefined;
  let prevLsp: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-lsp-'));
    prevWs = process.env.WORKSPACE_ROOT;
    prevLsp = process.env.SHINOBI_LSP;
    process.env.WORKSPACE_ROOT = dir; // permite escribir/leer dentro de dir
  });
  afterEach(() => {
    if (prevWs === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = prevWs;
    if (prevLsp === undefined) delete process.env.SHINOBI_LSP; else process.env.SHINOBI_LSP = prevLsp;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('lint_file reporta problemas de un fichero en disco', async () => {
    const f = path.join(dir, 'bad.ts');
    fs.writeFileSync(f, 'const a: number = ;\n');
    const res = await lintFileTool.execute({ path: f });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Diagnósticos/);
  });

  it('lint_file: fichero correcto → sin problemas', async () => {
    const f = path.join(dir, 'ok.ts');
    fs.writeFileSync(f, 'export const a = 1;\n');
    const res = await lintFileTool.execute({ path: f });
    expect(res.output).toMatch(/Sin problemas/);
  });

  it('write_file adjunta diagnósticos SOLO con SHINOBI_LSP=1', async () => {
    const f = path.join(dir, 'w.ts');
    const bad = 'const a: number = ;\n';

    delete process.env.SHINOBI_LSP;
    const off = await writeFileTool.execute({ path: f, content: bad });
    expect(off.success).toBe(true);
    expect(off.output).not.toMatch(/Diagnósticos/); // default: comportamiento de siempre

    process.env.SHINOBI_LSP = '1';
    const on = await writeFileTool.execute({ path: f, content: bad });
    expect(on.success).toBe(true);
    expect(on.output).toMatch(/Diagnósticos/);
  });
});
