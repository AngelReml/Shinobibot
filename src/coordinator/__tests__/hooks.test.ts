// Plan Hermes — ganchos del usuario alrededor de las tools.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseHooks, loadHooks, hooksFor, runHooks, describeHooks, _resetHooksCacheForTests } from '../hooks.js';

let dir: string;
const node = JSON.stringify(process.execPath);
/** Escribe un script de gancho y devuelve el comando que lo lanza. */
function script(name: string, body: string): string {
  const f = path.join(dir, name);
  fs.writeFileSync(f, body);
  return `${node} ${JSON.stringify(f)}`;
}
function configure(hooks: any[]) {
  fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({ hooks }));
  _resetHooksCacheForTests();
}

describe('ganchos del usuario (hooks.json)', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-hooks-'));
    process.env.SHINOBI_HOOKS_FILE = path.join(dir, 'hooks.json');
    delete process.env.SHINOBI_HOOKS;
    _resetHooksCacheForTests();
  });
  afterEach(() => {
    delete process.env.SHINOBI_HOOKS_FILE; delete process.env.SHINOBI_HOOKS;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sin fichero no hay ganchos y nada se bloquea', async () => {
    expect(loadHooks()).toEqual([]);
    expect(await runHooks('pre_tool', { tool: 'run_command', args: {} })).toEqual({ blocked: false, ran: 0 });
    expect(describeHooks()).toMatch(/No hay ganchos/);
  });

  it('descarta entradas mal formadas sin romper las buenas', () => {
    const hooks = parseHooks({ hooks: [
      { event: 'pre_tool', command: 'echo ok' },
      { event: 'inventado', command: 'echo no' },
      { event: 'post_tool', command: '   ' },
      { event: 'pre_tool', tool: '(sin cerrar', command: 'echo no' },
      { event: 'turn_end', command: 'echo fin', timeoutMs: 999999999 },
    ] });
    expect(hooks.map(h => h.event)).toEqual(['pre_tool', 'turn_end']);
    expect(hooks[1].timeoutMs).toBe(60000);
    expect(parseHooks('basura')).toEqual([]);
  });

  it('el filtro por tool está anclado: "run" no casa con "run_command"', () => {
    const hooks = parseHooks({ hooks: [
      { event: 'pre_tool', tool: 'run', command: 'a' },
      { event: 'pre_tool', tool: 'write_file|edit_file', command: 'b' },
      { event: 'pre_tool', command: 'c' },
    ] });
    expect(hooksFor('pre_tool', 'run_command', hooks).map(h => h.command)).toEqual(['c']);
    expect(hooksFor('pre_tool', 'edit_file', hooks).map(h => h.command)).toEqual(['b', 'c']);
    expect(hooksFor('post_tool', 'edit_file', hooks)).toEqual([]);
  });

  it('pre_tool con código 2 bloquea, da el motivo y no ejecuta los ganchos siguientes', async () => {
    const marker = path.join(dir, 'segundo.txt');
    configure([
      { event: 'pre_tool', tool: 'run_command', command: script('veto.js', `process.stderr.write('nada de rm en esta casa'); process.exit(2);`) },
      { event: 'pre_tool', command: script('segundo.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`) },
    ]);
    const r = await runHooks('pre_tool', { tool: 'run_command', args: { command: 'rm -rf x' } });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('nada de rm en esta casa');
    expect(fs.existsSync(marker)).toBe(false);
    const otro = await runHooks('pre_tool', { tool: 'read_file', args: {} });
    expect(otro.blocked).toBe(false);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('el gancho recibe por stdin el evento, la tool y los argumentos', async () => {
    const out = path.join(dir, 'visto.json');
    configure([{ event: 'post_tool', command: script('lee.js',
      `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>require('fs').writeFileSync(${JSON.stringify(out)}, s));`) }]);
    await runHooks('post_tool', { tool: 'write_file', args: { path: 'a.txt' }, result: { success: true } });
    const seen = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(seen).toEqual({ event: 'post_tool', tool: 'write_file', args: { path: 'a.txt' }, result: { success: true } });
  });

  it('un gancho que falla, no existe o se cuelga NO bloquea', async () => {
    configure([
      { event: 'pre_tool', command: script('falla.js', `process.exit(1);`) },
      { event: 'pre_tool', command: 'comando-que-no-existe-xyz' },
      { event: 'pre_tool', command: script('cuelga.js', `setTimeout(()=>{}, 60000);`), timeoutMs: 1500 },
    ]);
    const r = await runHooks('pre_tool', { tool: 'run_command', args: {} });
    expect(r).toEqual({ blocked: false, ran: 3 });
  });

  it('el código 2 solo veta en pre_tool, y SHINOBI_HOOKS=0 lo apaga todo', async () => {
    const veto = script('veto.js', `process.exit(2);`);
    configure([{ event: 'post_tool', command: veto }, { event: 'pre_tool', command: veto }]);
    expect((await runHooks('post_tool', { tool: 'x' })).blocked).toBe(false);
    expect((await runHooks('pre_tool', { tool: 'x' })).blocked).toBe(true);
    process.env.SHINOBI_HOOKS = '0';
    expect(await runHooks('pre_tool', { tool: 'x' })).toEqual({ blocked: false, ran: 0 });
  });
});
