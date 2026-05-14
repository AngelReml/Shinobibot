import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LocalRegistry, compareSemver } from '../registry/local_registry.js';
import { resolvePlan, satisfies } from '../registry/dep_resolver.js';
import { installFromRegistry, rollback, getInstalledInventory } from '../registry/installer.js';

let work: string;
let fixturesDir: string;

function makeFixture(name: string, body = '# body'): string {
  const dir = join(fixturesDir, name);
  mkdirSync(dir, { recursive: true });
  const fm = `---\nname: ${name}\ndescription: test skill ${name}\n---\n\n${body}\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm, 'utf-8');
  return dir;
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'sk-reg-'));
  fixturesDir = join(work, 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
});
afterEach(() => {
  try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
});

describe('compareSemver', () => {
  it('básico', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.10')).toBe(-1);
  });
  it('ignora pre-release suffix', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(0);
  });
});

describe('satisfies (range)', () => {
  it('^1.2.3 acepta 1.x.y >= 1.2.3', () => {
    expect(satisfies('^1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('^1.2.3', '1.9.0')).toBe(true);
    expect(satisfies('^1.2.3', '1.2.0')).toBe(false);
    expect(satisfies('^1.2.3', '2.0.0')).toBe(false);
  });
  it('~1.2.3 acepta 1.2.x >= 1.2.3', () => {
    expect(satisfies('~1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('~1.2.3', '1.2.9')).toBe(true);
    expect(satisfies('~1.2.3', '1.3.0')).toBe(false);
  });
  it('>=, >, <=, <', () => {
    expect(satisfies('>=1.0.0', '1.0.0')).toBe(true);
    expect(satisfies('>1.0.0',  '1.0.0')).toBe(false);
    expect(satisfies('<=2.0.0', '2.0.0')).toBe(true);
    expect(satisfies('<2.0.0',  '2.0.0')).toBe(false);
  });
  it('exacto', () => {
    expect(satisfies('1.0.0', '1.0.0')).toBe(true);
    expect(satisfies('1.0.0', '1.0.1')).toBe(false);
  });
  it('* y vacío', () => {
    expect(satisfies('*', '1.0.0')).toBe(true);
    expect(satisfies('', '1.0.0')).toBe(false);
  });
});

describe('LocalRegistry', () => {
  it('resolveLatest devuelve la versión más alta', async () => {
    const r = new LocalRegistry([
      { name: 'foo', version: '1.0.0', description: '', source: 'x' },
      { name: 'foo', version: '1.1.0', description: '', source: 'x' },
      { name: 'foo', version: '0.9.0', description: '', source: 'x' },
    ]);
    const latest = await r.resolveLatest('foo');
    expect(latest?.version).toBe('1.1.0');
  });
  it('resolveVersion exacto', async () => {
    const r = new LocalRegistry([
      { name: 'foo', version: '1.0.0', description: '', source: 'x' },
      { name: 'foo', version: '1.1.0', description: '', source: 'x' },
    ]);
    expect((await r.resolveVersion('foo', '1.0.0'))?.version).toBe('1.0.0');
    expect(await r.resolveVersion('foo', '9.9.9')).toBeNull();
  });
  it('skill inexistente → null', async () => {
    const r = new LocalRegistry([]);
    expect(await r.resolveLatest('nope')).toBeNull();
  });
});

describe('resolvePlan', () => {
  it('skill sin deps → 1 paso', async () => {
    const r = new LocalRegistry([{ name: 'a', version: '1.0.0', description: '', source: 'x' }]);
    const p = await resolvePlan('a', { registry: r });
    expect(p.steps).toHaveLength(1);
  });
  it('skill con deps → orden topológico', async () => {
    const r = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: '', source: 'x', requires: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', description: '', source: 'x', requires: { c: '^1.0.0' } },
      { name: 'c', version: '1.0.0', description: '', source: 'x' },
    ]);
    const p = await resolvePlan('a', { registry: r });
    expect(p.steps.map(s => s.name)).toEqual(['c', 'b', 'a']);
  });
  it('detecta ciclos', async () => {
    const r = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: '', source: 'x', requires: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', description: '', source: 'x', requires: { a: '^1.0.0' } },
    ]);
    await expect(resolvePlan('a', { registry: r })).rejects.toThrow(/ciclo/);
  });
  it('skip si dep ya instalada en versión compatible', async () => {
    const r = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: '', source: 'x', requires: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', description: '', source: 'x' },
    ]);
    const p = await resolvePlan('a', { registry: r, installedVersions: { b: '1.0.0' } });
    expect(p.steps.map(s => s.name)).toEqual(['a']);
    expect(p.skipped.map(s => s.name)).toContain('b');
  });
  it('skill root ya instalada en versión >= candidate → skipped', async () => {
    const r = new LocalRegistry([{ name: 'a', version: '1.0.0', description: '', source: 'x' }]);
    const p = await resolvePlan('a', { registry: r, installedVersions: { a: '1.0.0' } });
    expect(p.steps).toHaveLength(0);
    expect(p.skipped[0].name).toBe('a');
  });
  it('dep no satisface rango → throw', async () => {
    const r = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: '', source: 'x', requires: { b: '^2.0.0' } },
      { name: 'b', version: '1.0.0', description: '', source: 'x' },
    ]);
    await expect(resolvePlan('a', { registry: r })).rejects.toThrow(/no satisface/);
  });
  it('dep no existe en registry → throw', async () => {
    const r = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: '', source: 'x', requires: { b: '^1.0.0' } },
    ]);
    await expect(resolvePlan('a', { registry: r })).rejects.toThrow(/no está en el registry/);
  });
});

describe('installFromRegistry + rollback', () => {
  it('instala con deps y mantiene inventory', async () => {
    const f1 = makeFixture('s1');
    const f2 = makeFixture('s2');
    const reg = new LocalRegistry([
      { name: 's1', version: '1.0.0', description: 'first', source: f1 },
      { name: 's2', version: '1.0.0', description: 'depends on s1', source: f2, requires: { s1: '^1.0.0' } },
    ]);
    const skillsRoot = join(work, 'skills');
    const r = await installFromRegistry('s2', reg, { skillsRoot });
    expect(r.errors).toEqual([]);
    expect(r.installed.map(i => i.name)).toEqual(['s1', 's2']);
    const inv = getInstalledInventory(skillsRoot);
    expect(inv.s1).toBe('1.0.0');
    expect(inv.s2).toBe('1.0.0');
    expect(existsSync(join(skillsRoot, 'approved', 's1@1.0.0', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'approved', 's2@1.0.0', 'SKILL.md'))).toBe(true);
  });

  it('upgrade hace backup y permite rollback', async () => {
    const f = makeFixture('app');
    const regV1 = new LocalRegistry([{ name: 'app', version: '1.0.0', description: 'v1', source: f }]);
    const regBoth = new LocalRegistry([
      { name: 'app', version: '1.0.0', description: 'v1', source: f },
      { name: 'app', version: '1.1.0', description: 'v1.1', source: f },
    ]);
    const skillsRoot = join(work, 'skills');
    // Install v1.0.0
    await installFromRegistry('app', regV1, { skillsRoot });
    expect(getInstalledInventory(skillsRoot).app).toBe('1.0.0');
    // Upgrade to latest (1.1.0)
    await installFromRegistry('app', regBoth, { skillsRoot });
    expect(getInstalledInventory(skillsRoot).app).toBe('1.1.0');
    // Rollback
    const rb = await rollback('app', { skillsRoot });
    expect(rb.ok).toBe(true);
    expect(rb.restoredVersion).toBe('1.0.0');
    expect(getInstalledInventory(skillsRoot).app).toBe('1.0.0');
  });

  it('rollback sin backup → ok=false con mensaje', async () => {
    const r = await rollback('inexistente', { skillsRoot: join(work, 'skills') });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no está instalada|no hay backups/);
  });
});
