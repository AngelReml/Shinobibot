import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UserRegistry, isValidUserId } from '../user_registry.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'shinobi-usr-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

describe('isValidUserId', () => {
  it('acepta slugs válidos', () => {
    expect(isValidUserId('alice')).toBe(true);
    expect(isValidUserId('user_42')).toBe(true);
    expect(isValidUserId('a-b-c')).toBe(true);
  });
  it('rechaza inválidos', () => {
    expect(isValidUserId('')).toBe(false);
    expect(isValidUserId('Alice')).toBe(false); // mayúsculas
    expect(isValidUserId('hola mundo')).toBe(false);
    expect(isValidUserId('..')).toBe(false);
    expect(isValidUserId('a'.repeat(70))).toBe(false);
  });
});

describe('UserRegistry create/list/get', () => {
  it('vacío al inicio', () => {
    const r = new UserRegistry(work);
    expect(r.list()).toEqual([]);
    expect(r.ownerId()).toBeUndefined();
  });

  it('create owner + collaborator', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'angel', displayName: 'Angel', role: 'owner' });
    r.create({ userId: 'bob', displayName: 'Bob' });
    expect(r.list().length).toBe(2);
    expect(r.ownerId()).toBe('angel');
    expect(r.get('bob')?.role).toBe('collaborator');
  });

  it('crea userDir físico', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'alice', displayName: 'A' });
    expect(existsSync(join(work, 'alice'))).toBe(true);
  });

  it('rechaza dos owners', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'a', displayName: 'A', role: 'owner' });
    expect(() => r.create({ userId: 'b', displayName: 'B', role: 'owner' }))
      .toThrow(/owner/);
  });

  it('rechaza userId duplicado', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'x', displayName: 'X' });
    expect(() => r.create({ userId: 'x', displayName: 'Y' }))
      .toThrow(/existe/);
  });

  it('rechaza userId inválido', () => {
    const r = new UserRegistry(work);
    expect(() => r.create({ userId: '../etc/passwd', displayName: 'X' }))
      .toThrow(/inválido/);
  });
});

describe('persistencia', () => {
  it('survives restart', () => {
    const r1 = new UserRegistry(work);
    r1.create({ userId: 'angel', displayName: 'A', role: 'owner' });
    r1.create({ userId: 'bob', displayName: 'B' });
    const r2 = new UserRegistry(work);
    expect(r2.list().length).toBe(2);
    expect(r2.ownerId()).toBe('angel');
  });

  it('corrupted users.json → empty fresh state', () => {
    writeFileSync(join(work, 'users.json'), 'corrupted{{{', 'utf-8');
    const r = new UserRegistry(work);
    expect(r.list()).toEqual([]);
  });
});

describe('remove/transfer', () => {
  it('remove non-owner', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'a', displayName: 'A', role: 'owner' });
    r.create({ userId: 'b', displayName: 'B' });
    expect(r.remove('b')).toBe(true);
    expect(r.get('b')).toBeNull();
  });

  it('remove owner lanza', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'a', displayName: 'A', role: 'owner' });
    expect(() => r.remove('a')).toThrow(/owner/);
  });

  it('transferOwnership', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'a', displayName: 'A', role: 'owner' });
    r.create({ userId: 'b', displayName: 'B' });
    r.transferOwnership('b');
    expect(r.ownerId()).toBe('b');
    expect(r.get('a')?.role).toBe('collaborator');
  });
});

describe('scopedPath', () => {
  it('produce path correcto bajo userDir', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'alice', displayName: 'A' });
    const p = r.scopedPath('alice', 'memory.json');
    expect(p).toContain('alice');
    expect(p.endsWith('memory.json')).toBe(true);
  });

  it('rechaza traversal', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'alice', displayName: 'A' });
    expect(() => r.scopedPath('alice', '../bob/memory.json')).toThrow();
    expect(() => r.scopedPath('alice', 'subdir/foo')).toThrow();
  });
});

describe('canActOn — política de permisos', () => {
  it('owner puede todo', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'angel', displayName: 'A', role: 'owner' });
    r.create({ userId: 'bob', displayName: 'B' });
    expect(r.canActOn('angel', 'admin', 'bob')).toBe(true);
    expect(r.canActOn('angel', 'write', 'bob')).toBe(true);
  });

  it('collaborator: rw sobre self, read sobre otros, no admin', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'owner', displayName: 'O', role: 'owner' });
    r.create({ userId: 'bob', displayName: 'B' });
    r.create({ userId: 'alice', displayName: 'A' });
    expect(r.canActOn('bob', 'write', 'bob')).toBe(true);
    expect(r.canActOn('bob', 'read', 'alice')).toBe(true);
    expect(r.canActOn('bob', 'write', 'alice')).toBe(false);
    expect(r.canActOn('bob', 'admin', 'alice')).toBe(false);
  });

  it('guest: solo read sobre self', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'owner', displayName: 'O', role: 'owner' });
    r.create({ userId: 'g', displayName: 'G', role: 'guest' });
    expect(r.canActOn('g', 'read', 'g')).toBe(true);
    expect(r.canActOn('g', 'write', 'g')).toBe(false);
    expect(r.canActOn('g', 'read', 'owner')).toBe(false);
  });

  it('usuario desconocido → false', () => {
    const r = new UserRegistry(work);
    expect(r.canActOn('ghost', 'read', 'ghost')).toBe(false);
  });
});

describe('touchActive', () => {
  it('actualiza lastActiveAt', () => {
    const r = new UserRegistry(work);
    r.create({ userId: 'x', displayName: 'X' });
    expect(r.get('x')?.lastActiveAt).toBeUndefined();
    r.touchActive('x');
    expect(r.get('x')?.lastActiveAt).toBeTruthy();
    // persistido
    const r2 = new UserRegistry(work);
    expect(r2.get('x')?.lastActiveAt).toBeTruthy();
  });
});
