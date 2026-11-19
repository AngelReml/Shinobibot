// Plan Hermes — run_script: programa corto en sandbox que llama a tools de solo lectura.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import tool, { runScript, scriptAllowedTools, SCRIPT_MAX_TOOL_CALLS, SCRIPT_MAX_OUTPUT_CHARS, type ToolCaller } from '../run_script.js';
import { getTool } from '../tool_registry.js';
import { DESTRUCTIVE_TOOLS } from '../../security/approval.js';

const echo: ToolCaller = async (name, args) => ({ success: true, output: `${name}:${JSON.stringify(args)}` });

describe('run_script', () => {
  it('se registra, y ninguna tool destructiva está en su lista blanca', () => {
    expect(getTool('run_script')).toBeDefined();
    const allowed = scriptAllowedTools();
    for (const t of DESTRUCTIVE_TOOLS) expect(allowed.has(t)).toBe(false);
    expect(allowed.has('run_script')).toBe(false);
    expect(allowed.has('spawn_agent')).toBe(false);
  });

  it('ejecuta código, junta lo impreso con lo devuelto y cuenta las llamadas', async () => {
    const r = await runScript(`
      let n = 0;
      for (const p of ['a', 'b', 'c']) { const x = await tools.call('read_file', { path: p }); if (x.success) n++; }
      print('leídos', n, { ok: true });
      return { total: n };
    `, { call: echo });
    expect(r).toEqual({ ok: true, output: 'leídos 3 {"ok":true}\n{"total":3}', toolCalls: 3 });
  });

  it('una tool fuera de la lista blanca devuelve error al script y NO llega a ejecutarse', async () => {
    const called: string[] = [];
    const spy: ToolCaller = async (n) => { called.push(n); return { success: true, output: 'x' }; };
    const r = await runScript(`
      const a = await tools.call('run_command', { command: 'rm -rf /' });
      const b = await tools.call('write_file', { path: 'x', content: 'y' });
      const c = await tools.call('list_dir', { path: '.' });
      return [a.success, /no está permitida/.test(a.error), b.success, c.success];
    `, { call: spy });
    expect(r.output).toBe('[false,true,false,true]');
    expect(called).toEqual(['list_dir']);
    expect(r.toolCalls).toBe(1);
  });

  it('no hay salida del sandbox: ni require, ni process, ni import, ni las referencias internas', async () => {
    const r = await runScript(`
      const probes = {
        require: typeof require, process: typeof process, fetch: typeof fetch,
        print_ref: typeof __print, call_ref: typeof __call, globalThisCall: typeof globalThis.__call,
        closure_p: typeof __p, closure_c: typeof __c,
      };
      let viaCtor = 'bloqueado';
      try { viaCtor = (function(){}).constructor('return typeof process')(); } catch (e) { viaCtor = 'error'; }
      let imp = 'bloqueado';
      try { await import('fs'); imp = 'IMPORTADO'; } catch (e) { imp = 'error'; }
      return { ...probes, viaCtor, imp };
    `, { call: echo });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.output)).toEqual({
      require: 'undefined', process: 'undefined', fetch: 'undefined',
      print_ref: 'undefined', call_ref: 'undefined', globalThisCall: 'undefined',
      closure_p: 'undefined', closure_c: 'undefined',
      viaCtor: 'undefined', imp: 'error',
    });
  });

  it('corta un bucle infinito y un script que espera para siempre', async () => {
    const cpu = await runScript(`while (true) {}`, { call: echo, timeoutMs: 300 });
    expect(cpu.ok).toBe(false);
    const slow: ToolCaller = () => new Promise(res => setTimeout(() => res({ success: true, output: 'tarde' }), 5000));
    const t0 = Date.now();
    const wait = await runScript(`print('antes'); await tools.call('read_file', {}); return 'nunca';`, { call: slow, timeoutMs: 300 });
    expect(wait.ok).toBe(false);
    expect(wait.error).toMatch(/superó/);
    expect(wait.output).toBe('antes');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('respeta el tope de llamadas y el de salida', async () => {
    const r = await runScript(`
      let fail = 0;
      for (let i = 0; i < ${SCRIPT_MAX_TOOL_CALLS + 5}; i++) { const x = await tools.call('list_dir', {}); if (!x.success) fail++; }
      return fail;
    `, { call: echo });
    expect(r.output).toBe('5');
    const big = await runScript(`for (let i = 0; i < 5000; i++) print('x'.repeat(100)); return 'fin';`, { call: echo });
    expect(big.output.length).toBeLessThanOrEqual(SCRIPT_MAX_OUTPUT_CHARS);
  });

  it('un error del script o de una tool vuelve como error legible, con lo impreso hasta entonces', async () => {
    const r = await runScript(`print('paso 1'); throw new Error('algo se rompió');`, { call: echo });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/algo se rompió/);
    expect(r.output).toBe('paso 1');
    const boom: ToolCaller = async () => { throw new Error('disco lleno'); };
    const t = await runScript(`const x = await tools.call('read_file', {}); return x.error;`, { call: boom });
    expect(t.output).toBe('disco lleno');
    expect((await runScript(`esto no es javascript (`, { call: echo })).ok).toBe(false);
  });

  it('con las tools reales: lee ficheros de verdad y devuelve solo el resumen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-script-'));
    const prev = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = dir;
    try {
      await import('../read_file.js'); await import('../list_dir.js');
      fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\ndos\ntres');
      fs.writeFileSync(path.join(dir, 'b.txt'), 'cuatro');
      const r = await tool.execute({ code: `
        let lines = 0;
        for (const f of ['a.txt', 'b.txt']) {
          const x = await tools.call('read_file', { path: ${JSON.stringify(dir)} + '/' + f });
          if (!x.success) throw new Error(x.error);
          lines += (x.output.match(/uno|dos|tres|cuatro/g) || []).length;
        }
        return 'palabras: ' + lines;` });
      expect(r.error).toBeUndefined();
      expect(r.output).toContain('palabras: 4');
      expect(r.output).toContain('[2 llamada(s) a tools]');
      expect((await tool.execute({ code: '  ' })).success).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
