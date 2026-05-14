import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  discoverPlugins,
  loadAllPlugins,
  importPlugin,
} from '../plugin_loader.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `shinobi-plugins-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
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
  it('importa el entry y devuelve el módulo', async () => {
    writePlugin('alpha', validManifest(), 'export const hello = "world";');
    const { discovered } = discoverPlugins(tmpRoot);
    expect(discovered).toHaveLength(1);
    const mod: any = await importPlugin(discovered[0]);
    expect(mod.hello).toBe('world');
  });
});

describe('loadAllPlugins', () => {
  it('discover + import en una sola llamada', async () => {
    writePlugin('a', { ...validManifest(), name: 'shinobi-plugin-aa' }, 'export const k = 1;');
    writePlugin('b', { ...validManifest(), name: 'shinobi-plugin-bb' }, 'export const k = 2;');
    const { loaded, errors } = await loadAllPlugins(tmpRoot);
    expect(loaded).toHaveLength(2);
    expect(errors).toEqual([]);
    const values = loaded.map((p: any) => (p.module as any).k).sort();
    expect(values).toEqual([1, 2]);
  });

  it('plugin con import error queda en errors, los demás cargan', async () => {
    writePlugin('good', { ...validManifest(), name: 'shinobi-plugin-good' }, 'export const ok = true;');
    writePlugin('bad', { ...validManifest(), name: 'shinobi-plugin-bad' }, 'throw new Error("boom");');
    const { loaded, errors } = await loadAllPlugins(tmpRoot);
    expect(loaded).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.errors.some(msg => msg.includes('import falló')))).toBe(true);
  });
});
