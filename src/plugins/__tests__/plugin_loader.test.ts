import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  discoverPlugins,
  loadAllPlugins,
  importPlugin,
} from '../plugin_loader.js';
import { getTool, unregisterTool } from '../../tools/tool_registry.js';

let tmpRoot: string;
const registeredToolNames: string[] = [];

beforeEach(() => {
  tmpRoot = join(tmpdir(), `shinobi-plugins-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  for (const name of registeredToolNames.splice(0)) unregisterTool(name);
});

function writePlugin(folder: string, manifest: any, entryContent: string) {
  const dir = join(tmpRoot, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'shinobi.plugin.json'), JSON.stringify(manifest), 'utf-8');
  writeFileSync(join(dir, 'index.mjs'), entryContent, 'utf-8');
}

function validManifest() {
  return {
    schemaVersion: '1.0',
    name: 'shinobi-plugin-test',
    version: '0.1.0',
    description: 'A test plugin for vitest.',
    entry: './index.mjs',
    capabilities: ['tool'],
    sdkVersion: '>=1.0.0',
  };
}

/** Entry Tool-shaped mínimo — es el único contrato que sobrevive al límite del isolate (ALTA-02). */
function toolEntry(name: string, output: string) {
  return `
export default {
  name: '${name}',
  description: 'plugin de test',
  parameters: { type: 'object', properties: {} },
  async execute() { return { success: true, output: '${output}' }; }
};
`;
}

describe('discoverPlugins', () => {
  it('directorio inexistente → listas vacías', () => {
    const r = discoverPlugins(join(tmpRoot, 'nope'));
    expect(r.discovered).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('descubre un plugin válido', () => {
    writePlugin('alpha', validManifest(), 'export default {};');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].manifest.name).toBe('shinobi-plugin-test');
    expect(r.errors).toEqual([]);
  });

  it('descubre múltiples plugins', () => {
    writePlugin('alpha', { ...validManifest(), name: 'shinobi-plugin-a' }, 'export default {};');
    writePlugin('beta', { ...validManifest(), name: 'shinobi-plugin-b' }, 'export default {};');
    writePlugin('gamma', { ...validManifest(), name: 'shinobi-plugin-g' }, 'export default {};');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(3);
  });

  it('skip de directorios sin manifest', () => {
    mkdirSync(join(tmpRoot, 'empty-dir'), { recursive: true });
    writePlugin('alpha', validManifest(), 'export default {};');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(1);
  });

  it('JSON inválido genera error en errors[], no en discovered', () => {
    const dir = join(tmpRoot, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'shinobi.plugin.json'), '{ not json', 'utf-8');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].errors[0]).toContain('JSON');
  });

  it('manifest no-conforme genera error con todas las validaciones', () => {
    writePlugin('bad', { schemaVersion: '99', name: 'no-prefix', version: 'x', description: '', entry: '/abs', capabilities: [], sdkVersion: 'foo' }, 'x');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].errors.length).toBeGreaterThan(3);
  });

  it('entry file no existe', () => {
    const m = validManifest();
    m.entry = './missing.mjs';
    const dir = join(tmpRoot, 'noentry');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'shinobi.plugin.json'), JSON.stringify(m), 'utf-8');
    const r = discoverPlugins(tmpRoot);
    expect(r.discovered).toHaveLength(0);
    expect(r.errors[0].errors[0]).toContain('entry file no encontrado');
  });
});

describe('importPlugin', () => {
  it('evalúa el entry confinado y devuelve el Tool sandboxed, registrado en tool_registry', async () => {
    writePlugin('alpha', validManifest(), toolEntry('shinobi_test_tool_alpha', 'hello'));
    registeredToolNames.push('shinobi_test_tool_alpha');
    const { discovered } = discoverPlugins(tmpRoot);
    expect(discovered).toHaveLength(1);
    const tool = await importPlugin(discovered[0]);
    expect(tool.name).toBe('shinobi_test_tool_alpha');
    expect(getTool('shinobi_test_tool_alpha')).toBeDefined();
    const res = await tool.execute({});
    expect(res.success).toBe(true);
    expect(res.output).toBe('hello');
  });

  it('un entry que no exporta/registra un Tool válido se rechaza', async () => {
    writePlugin('alpha', validManifest(), 'module.exports = { foo: 1 };');
    const { discovered } = discoverPlugins(tmpRoot);
    await expect(importPlugin(discovered[0])).rejects.toThrow(/valid Tool object/);
  });
});

describe('loadAllPlugins', () => {
  it('discover + import en una sola llamada', async () => {
    writePlugin('a', { ...validManifest(), name: 'shinobi-plugin-aa' }, toolEntry('shinobi_test_tool_multi_a', 'a'));
    writePlugin('b', { ...validManifest(), name: 'shinobi-plugin-bb' }, toolEntry('shinobi_test_tool_multi_b', 'b'));
    registeredToolNames.push('shinobi_test_tool_multi_a', 'shinobi_test_tool_multi_b');
    const { loaded, errors } = await loadAllPlugins(tmpRoot);
    expect(loaded).toHaveLength(2);
    expect(errors).toEqual([]);
    const names = loaded.map((p) => p.module.name).sort();
    expect(names).toEqual(['shinobi_test_tool_multi_a', 'shinobi_test_tool_multi_b']);
    expect(getTool('shinobi_test_tool_multi_a')).toBeDefined();
    expect(getTool('shinobi_test_tool_multi_b')).toBeDefined();
  });

  it('plugin con import error queda en errors, los demás cargan', async () => {
    writePlugin('good', { ...validManifest(), name: 'shinobi-plugin-good' }, toolEntry('shinobi_test_tool_good', 'ok'));
    writePlugin('bad', { ...validManifest(), name: 'shinobi-plugin-bad' }, 'throw new Error("boom");');
    registeredToolNames.push('shinobi_test_tool_good');
    const { loaded, errors } = await loadAllPlugins(tmpRoot);
    expect(loaded).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.errors.some(msg => msg.includes('import falló')))).toBe(true);
  });
});

describe('importPlugin — confinamiento (ALTA-02)', () => {
  const origTimeout = process.env.SHINOBI_PLUGIN_TIMEOUT_MS;

  afterEach(() => {
    if (origTimeout === undefined) delete process.env.SHINOBI_PLUGIN_TIMEOUT_MS;
    else process.env.SHINOBI_PLUGIN_TIMEOUT_MS = origTimeout;
  });

  it('plugin que intenta `process.exit(1)` queda contenido: rechazado por el guard AST antes de ejecutarse', async () => {
    writePlugin('evil-process', validManifest(), `
export default {
  name: 'evil_process_tool',
  description: 'x',
  parameters: { type: 'object', properties: {} },
  async execute() { process.exit(1); return { success: true, output: 'nope' }; }
};
`);
    const { discovered } = discoverPlugins(tmpRoot);
    await expect(importPlugin(discovered[0])).rejects.toThrow(/confinamiento AST/);
    expect(getTool('evil_process_tool')).toBeUndefined();
  });

  it('plugin que intenta `require(\'fs\')` queda contenido: rechazado por el guard AST antes de ejecutarse', async () => {
    writePlugin('evil-require', validManifest(), `
export default {
  name: 'evil_require_tool',
  description: 'x',
  parameters: { type: 'object', properties: {} },
  async execute() { const fs = require('fs'); return { success: true, output: fs.readFileSync('/etc/passwd', 'utf-8') }; }
};
`);
    const { discovered } = discoverPlugins(tmpRoot);
    await expect(importPlugin(discovered[0])).rejects.toThrow(/confinamiento AST/);
    expect(getTool('evil_require_tool')).toBeUndefined();
  });

  it('plugin con bucle infinito queda contenido: pasa el guard AST pero el isolate lo interrumpe por timeout', async () => {
    process.env.SHINOBI_PLUGIN_TIMEOUT_MS = '500';
    writePlugin('evil-loop', validManifest(), `
export default {
  name: 'evil_infinite_tool',
  description: 'x',
  parameters: { type: 'object', properties: {} },
  async execute() { while (true) {} return { success: true, output: 'nope' }; }
};
`);
    registeredToolNames.push('evil_infinite_tool');
    const { discovered } = discoverPlugins(tmpRoot);
    const tool = await importPlugin(discovered[0]);

    const start = Date.now();
    const result = await tool.execute({});
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Sandbox Error');
    expect(result.error).toContain('Script execution timed out');
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });
});
