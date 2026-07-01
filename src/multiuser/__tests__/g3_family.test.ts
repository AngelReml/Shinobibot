import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// Regresión (auditoría 2026-07-01): resolveUser bloqueaba CUALQUIER rol no-guest
// existente, incluido 'family' — un usuario familia que mandaba su propio
// userId ya dado de alta por el operador era escalado a OWNER sin
// restricciones, en cualquier canal (WS y HTTP), dejando familyApprovalGate
// inalcanzable en la práctica. Reproduce el camino real header → resolveUser,
// no solo familyApprovalGate aislado (que ya estaba cubierto arriba).
describe('resolveUser — family seleccionable, privilegiados bloqueados (G3 + CRIT-04)', () => {
  afterEach(() => {
    delete process.env.SHINOBI_USERS_ROOT;
    delete process.env.SHINOBI_TRUST_USER_HEADER;
  });

  it('un header que apunta a una cuenta family existente SÍ la selecciona (no escala a owner)', async () => {
    const { _resetMultiuserWiring, resolveUser, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid4', displayName: 'Kid4' });

    const resolved = resolveUser('kid4');
    expect(resolved.role).toBe('family');
    expect(resolved.userId).toBe('kid4');
  });

  it('un header que apunta a un collaborator existente sigue cayendo a owner (sin escalada)', async () => {
    const { _resetMultiuserWiring, resolveUser, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const reg = userRegistry();
    reg.create({ userId: 'collab1', displayName: 'Collab', role: 'collaborator' });

    const resolved = resolveUser('collab1');
    expect(resolved.role).not.toBe('collaborator');
    expect(resolved.role).toBe('owner');
  });
});

// Regresión ALTA-06/ALTA-07/MEDIA-07/MEDIA-08/ALTA-25 (auditoría 2026-07-01).
describe('UserRegistry.canActOn — collaborator no lee al owner (ALTA-06)', () => {
  let reg: UserRegistry;
  beforeEach(() => { reg = freshRegistry(); });

  it('collaborator NO puede leer el scope del owner', () => {
    reg.create({ userId: 'owner', displayName: 'Owner', role: 'owner' });
    reg.create({ userId: 'collab1', displayName: 'Collab', role: 'collaborator' });
    expect(reg.canActOn('collab1', 'read', 'owner')).toBe(false);
  });

  it('collaborator SÍ puede leer el scope de otro collaborator/guest (equipo)', () => {
    reg.create({ userId: 'owner', displayName: 'Owner', role: 'owner' });
    reg.create({ userId: 'collab1', displayName: 'Collab1', role: 'collaborator' });
    reg.create({ userId: 'collab2', displayName: 'Collab2', role: 'collaborator' });
    expect(reg.canActOn('collab1', 'read', 'collab2')).toBe(true);
  });

  it('owner puede leer/escribir/administrar cualquier scope', () => {
    reg.create({ userId: 'owner', displayName: 'Owner', role: 'owner' });
    reg.create({ userId: 'collab1', displayName: 'Collab', role: 'collaborator' });
    expect(reg.canActOn('owner', 'read', 'collab1')).toBe(true);
    expect(reg.canActOn('owner', 'admin', 'collab1')).toBe(true);
  });
});

describe('UserRegistry.update restrictions={} no vacía la caja (ALTA-07)', () => {
  let reg: UserRegistry;
  beforeEach(() => { reg = freshRegistry(); });

  it('update(userId, {restrictions: {}}) preserva las restricciones existentes', () => {
    reg.createFamily({ userId: 'kid', displayName: 'Kid' });
    const updated = reg.update('kid', { restrictions: {} as any });
    expect(updated.restrictions?.noShell).toBe(true);
    expect(updated.restrictions?.noDestructive).toBe(true);
    expect(updated.restrictions?.noCriticalPaths).toBe(true);
  });

  it('update sigue permitiendo relajar un campo específico', () => {
    reg.createFamily({ userId: 'kid2', displayName: 'Kid2' });
    const updated = reg.update('kid2', { restrictions: { noShell: false } as any });
    expect(updated.restrictions?.noShell).toBe(false);
    expect(updated.restrictions?.noDestructive).toBe(true); // el resto no se toca
  });
});

describe('UserRegistry — recarga si users.json cambia externamente (MEDIA-07)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('get() ve una revocación hecha directamente en disco por otra instancia', async () => {
    const dir = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    const reg1 = new UserRegistry(dir);
    reg1.create({ userId: 'owner', displayName: 'Owner', role: 'owner' });
    reg1.create({ userId: 'collab1', displayName: 'Collab', role: 'collaborator' });

    // Margen para asegurar un mtime distinguible del siguiente write (algunos
    // filesystems tienen resolución de mtime gruesa) — no forma parte del
    // fix en sí, solo hace el test determinista.
    await sleep(20);

    // Segunda instancia (simula otro proceso/reload) revoca a collab1.
    const reg2 = new UserRegistry(dir);
    reg2.remove('collab1');

    // reg1 (la instancia "vieja") debe ver la revocación al releer, no quedarse
    // con el estado cacheado del boot.
    expect(reg1.get('collab1')).toBeNull();
  });
});

describe('familyApprovalGate — SENSITIVE cubre variantes de .env/authorized_keys (MEDIA-08)', () => {
  it('bloquea .env.local, .env.production y authorized_keys2', async () => {
    const { _resetMultiuserWiring, familyApprovalGate, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid6', displayName: 'Kid6' });
    const gate = familyApprovalGate('kid6')!;

    expect(await gate('write_file', { path: '/home/user/.env.local' })).toBe(false);
    expect(await gate('write_file', { path: '/home/user/.env.production' })).toBe(false);
    expect(await gate('write_file', { path: '/home/user/.ssh/authorized_keys2' })).toBe(false);
    // sanity: rutas normales siguen permitidas.
    expect(await gate('write_file', { path: '/home/user/notas.txt' })).toBe(true);
    delete process.env.SHINOBI_USERS_ROOT;
  });
});

describe('resolveUser — cap de guests efímeros (ALTA-25)', () => {
  afterEach(() => {
    delete process.env.SHINOBI_USERS_ROOT;
    delete process.env.SHINOBI_TRUST_USER_HEADER;
    delete process.env.SHINOBI_MAX_GUESTS;
  });

  it('al alcanzar el cap, nuevos userIds se atienden como guest efímero sin persistir', async () => {
    const { _resetMultiuserWiring, resolveUser, userRegistry } = await import('../multiuser_wiring.js');
    _resetMultiuserWiring();
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    process.env.SHINOBI_MAX_GUESTS = '2';

    resolveUser('guest1');
    resolveUser('guest2');
    // El registry ya tiene 2 guests (+ el owner bootstrap) → el cap está lleno.
    const before = userRegistry().list().filter((u) => u.role === 'guest').length;
    expect(before).toBe(2);

    const overflow = resolveUser('guest3');
    expect(overflow.role).toBe('guest');
    expect(overflow.userId).toBe('guest3');
    // NO se persistió — el registry sigue teniendo solo 2 guests.
    const after = userRegistry().list().filter((u) => u.role === 'guest').length;
    expect(after).toBe(2);
    expect(userRegistry().get('guest3')).toBeNull();
  });
});
