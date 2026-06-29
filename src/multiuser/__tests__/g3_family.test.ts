import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { UserRegistry, FAMILY_DEFAULTS } from '../user_registry.js';

function freshRegistry() {
  return new UserRegistry(join(tmpdir(), `shinobi-test-${randomUUID()}`));
}

describe('UserRegistry — family mode (G3)', () => {
  let reg: UserRegistry;
  beforeEach(() => { reg = freshRegistry(); });

  it('createFamily sets role=family and restrictions', () => {
    const u = reg.createFamily({ userId: 'mama', displayName: 'Mamá' });
    expect(u.role).toBe('family');
    expect(u.restrictions).toMatchObject(FAMILY_DEFAULTS);
  });

  it('createFamily merges partial restrictions', () => {
    const u = reg.createFamily({ userId: 'nino', displayName: 'Nico', restrictions: { maxIterationsPerSession: 8 } });
    expect(u.restrictions?.maxIterationsPerSession).toBe(8);
    expect(u.restrictions?.noShell).toBe(true);
  });

  it('update patches restrictions without losing other fields', () => {
    reg.createFamily({ userId: 'papa', displayName: 'Papá' });
    const updated = reg.update('papa', { restrictions: { ...FAMILY_DEFAULTS, maxIterationsPerSession: 20 } });
    expect(updated.restrictions?.maxIterationsPerSession).toBe(20);
    expect(updated.restrictions?.noShell).toBe(true);
    expect(updated.displayName).toBe('Papá');
  });

  it('list() includes family users', () => {
    reg.createFamily({ userId: 'sis', displayName: 'Hermana' });
    const families = reg.list().filter(u => u.role === 'family');
    expect(families).toHaveLength(1);
    expect(families[0].userId).toBe('sis');
  });

  it('remove() deletes family user', () => {
    reg.createFamily({ userId: 'bro', displayName: 'Hermano' });
    const ok = reg.remove('bro');
    expect(ok).toBe(true);
    expect(reg.get('bro')).toBeNull();
  });
});

describe('familyApprovalGate', () => {
  it('returns null for non-family user', async () => {
    const { _resetMultiuserWiring, familyApprovalGate, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    // owner has no restrictions → gate is null
    const gate = familyApprovalGate('owner');
    expect(gate).toBeNull();
    delete process.env.SHINOBI_USERS_ROOT;
  });

  it('denies shell tools for family user', async () => {
    const { _resetMultiuserWiring, familyApprovalGate, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    const dir = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_USERS_ROOT = dir;
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid', displayName: 'Kid' });
    const gate = familyApprovalGate('kid')!;
    expect(gate).not.toBeNull();
    expect(await gate('run_command', { cmd: 'rm -rf /' })).toBe(false);
    delete process.env.SHINOBI_USERS_ROOT;
  });

  it('allows read_file for family user', async () => {
    const { _resetMultiuserWiring, familyApprovalGate, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    const dir = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_USERS_ROOT = dir;
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid2', displayName: 'Kid2' });
    const gate = familyApprovalGate('kid2')!;
    expect(await gate('read_file', { path: '/home/user/doc.txt' })).toBe(true);
    delete process.env.SHINOBI_USERS_ROOT;
  });

  it('denies critical path write for family user', async () => {
    const { _resetMultiuserWiring, familyApprovalGate, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    const dir = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_USERS_ROOT = dir;
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid3', displayName: 'Kid3' });
    const gate = familyApprovalGate('kid3')!;
    expect(await gate('write_file', { path: '/home/user/.env' })).toBe(false);
    delete process.env.SHINOBI_USERS_ROOT;
  });
});
