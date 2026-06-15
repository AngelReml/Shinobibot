/**
 * KN-01..KN-04 — la frontera: linter de imports, contrato/cargador, mediación de
 * syscalls e inmutabilidad. Cubre P1 (inmutabilidad), P2 (aislamiento), P3 (CSV).
 */
import { describe, it, expect, vi } from 'vitest';
import { kanameEnabled } from '../config.js';
import { classifyZone, lintBoundary, boundaryClean } from '../boundary.js';
import { coreHash, writeAllowed, guardCoreWrite } from '../immutability.js';
import { loadSkill } from '../contract.js';
import { makeMediator, SyscallDenied, type KernelHost } from '../mediator.js';
import type { SkillManifestLite } from '../types.js';
import type { SkillCSVLike } from '../../integrity/csv_verify.js';

describe('kaname — KN-01 linter de frontera', () => {
  it('flag default off; clasifica zonas', () => {
    expect(kanameEnabled()).toBe(false);
    expect(classifyZone('src/integrity/checks.ts')).toBe('core');
    expect(classifyZone('src/shugyo/demo.ts')).toBe('userspace');
    expect(classifyZone('src/kaname/contract.ts')).toBe('contract');
    expect(classifyZone('src/web/server.ts')).toBe('external');
  });
  it('marca userspace→core y core→userspace; deja pasar lo correcto', () => {
    const v = lintBoundary([
      { from: 'src/shugyo/x.ts', to: 'src/integrity/checks.ts' },     // userspace→core ✗
      { from: 'src/coordinator/o.ts', to: 'src/kagemusha/y.ts' },     // core→userspace ✗
      { from: 'src/kaname/contract.ts', to: 'src/integrity/csv_verify.ts' }, // contrato→core ✓
      { from: 'src/shugyo/a.ts', to: 'src/kagemusha/b.ts' },          // userspace→userspace ✓
    ]);
    expect(v).toHaveLength(2);
    expect(v[0].reason).toMatch(/userspace importa el núcleo/);
    expect(boundaryClean([{ from: 'src/kaname/x.ts', to: 'src/integrity/y.ts' }])).toBe(true);
  });
});

describe('kaname — KN-04 inmutabilidad (P1)', () => {
  it('hash determinista y estable ante reordenación', () => {
    const a = coreHash([{ path: 'src/integrity/a.ts', content: 'x' }, { path: 'src/tenshu/b.ts', content: 'y' }]);
    const b = coreHash([{ path: 'src/tenshu/b.ts', content: 'y' }, { path: 'src/integrity/a.ts', content: 'x' }]);
    expect(a).toBe(b);
    expect(coreHash([{ path: 'src/integrity/a.ts', content: 'CHANGED' }, { path: 'src/tenshu/b.ts', content: 'y' }])).not.toBe(a);
  });
  it('P1 — solo la promoción escribe el núcleo; runtime/skill/swarm bloqueados', () => {
    expect(writeAllowed({ path: 'src/integrity/checks.ts', origin: 'promotion' })).toBe(true);
    expect(writeAllowed({ path: 'src/integrity/checks.ts', origin: 'swarm' })).toBe(false);
    expect(writeAllowed({ path: 'src/shugyo/skill.ts', origin: 'swarm' })).toBe(true);   // userspace libre
    expect(() => guardCoreWrite({ path: 'src/tenshu/x.ts', origin: 'skill' })).toThrow(/BLOQUEADO/);
    expect(() => guardCoreWrite({ path: 'src/kagemusha/x.ts', origin: 'swarm' })).not.toThrow();
  });
});

describe('kaname — KN-02 contrato/cargador (P3 certificación en puerta)', () => {
  const manifest: SkillManifestLite = { skill_id: 'x.v1', declared_tools: ['read_file'], declared_effects: 'read_only' };
  it('rechaza sin CSV', () => {
    const r = loadSkill(manifest, null);
    expect(r.admitted).toBe(false); expect(r.record.status).toBe('rejected'); expect(r.reason).toMatch(/sin CSV/);
  });
  it('rechaza CSV NOT_CERTIFIED', () => {
    const csv: SkillCSVLike = { verdict: 'NOT_CERTIFIED', subject: { skill_id: 'x.v1' } };
    expect(loadSkill(manifest, csv).admitted).toBe(false);
  });
  it('rechaza un CSV no válido (subject ajeno / sin firma) — la puerta no se abre', () => {
    const csv: SkillCSVLike = { verdict: 'CERTIFIED', subject: { skill_id: 'OTRA' } } as any;
    expect(loadSkill(manifest, csv).admitted).toBe(false);   // no entra; el binding se comprueba sobre CSV ya válido
  });
});

describe('kaname — KN-03 mediación (P2 aislamiento)', () => {
  const host: KernelHost = {
    readInput: vi.fn(async (ref) => ({ ref, data: 'ok' })),
    writeOutput: vi.fn(async () => {}),
    invokeTool: vi.fn(async () => 'tool-ok'),
    requestApproval: vi.fn(async () => true),
    log: vi.fn(),
  };
  const manifest: SkillManifestLite = { skill_id: 's', declared_tools: ['read_file'], declared_effects: 'read_only', reads: ['in.txt'], writes: [] };
  const sys = makeMediator(manifest, host);

  it('permite lo declarado', async () => {
    await expect(sys.readInput('in.txt')).resolves.toEqual({ ref: 'in.txt', data: 'ok' });
    await expect(sys.invokeTool('read_file', {})).resolves.toBe('tool-ok');
  });
  it('DENIEGA tool no declarada', async () => {
    await expect(sys.invokeTool('delete_file', {})).rejects.toBeInstanceOf(SyscallDenied);
  });
  it('DENIEGA efecto por encima del declarado (read_only no escribe)', async () => {
    await expect(sys.writeOutput('out.txt', { ref: 'out.txt', data: 1 })).rejects.toThrow(/excede declared_effects/);
  });
  it('DENIEGA ref fuera de scope de lectura', async () => {
    await expect(sys.readInput('secreto.txt')).rejects.toThrow(/fuera del scope/);
  });
});
