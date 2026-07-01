// Regresión CRIT-12 (auditoría 2026-07-01): `curatedMemory()` era un
// singleton global — cualquier usuario en modo multi-usuario recibía el
// snapshot (USER.md/MEMORY.md) del OWNER en su system prompt. Ahora
// `curatedMemory({key, memoryDir})` da una instancia AISLADA por usuario.
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { curatedMemory, _resetCuratedMemoryInstances } from '../curated_memory.js';

// Fuerza embeddings hash (determinísticos, sin red ni modelo ONNX) — appendEnv
// pasa por ContradictionFilter.check(), que usa sharedMemoryStore() internamente.
process.env.SHINOBI_EMBED_PROVIDER = 'hash';

describe('curatedMemory(vault) — aislamiento por usuario (CRIT-12)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    _resetCuratedMemoryInstances();
    while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* noop */ } }
  });

  function freshVaultDir(): string {
    const d = join(tmpdir(), `shinobi-vault-test-${randomUUID()}`);
    dirs.push(d);
    return d;
  }

  it('dos usuarios distintos obtienen instancias distintas, sin mezclar contenido', async () => {
    const aliceDir = freshVaultDir();
    const bobDir = freshVaultDir();

    const alice = curatedMemory({ key: 'alice', memoryDir: aliceDir });
    await alice.appendEnv('Alice: nota secreta de Alice');

    const bob = curatedMemory({ key: 'bob', memoryDir: bobDir });
    await bob.appendEnv('Bob: nota secreta de Bob');

    expect(alice).not.toBe(bob);
    expect(alice.getSnapshot()).toContain('Alice');
    expect(alice.getSnapshot()).not.toContain('Bob: nota secreta de Bob');
    expect(bob.getSnapshot()).toContain('Bob');
    expect(bob.getSnapshot()).not.toContain('Alice: nota secreta de Alice');
  });

  it('la misma key devuelve SIEMPRE la misma instancia cacheada (no relee vault en cada llamada)', () => {
    const dir = freshVaultDir();
    const a1 = curatedMemory({ key: 'kid', memoryDir: dir });
    const a2 = curatedMemory({ key: 'kid', memoryDir: dir });
    expect(a1).toBe(a2);
  });

  it('sin vault (owner) sigue devolviendo el singleton preexistente ligado al cwd', () => {
    const o1 = curatedMemory();
    const o2 = curatedMemory();
    expect(o1).toBe(o2);
  });
});
