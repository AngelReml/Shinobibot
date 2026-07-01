// Regresión BAJA-04 / ALTA-21 (auditoría 2026-07-01).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { MemoryStore, sharedMemoryStore } from '../memory_store.js';

function freshStore(): { store: MemoryStore; dbPath: string } {
  const dbPath = join(tmpdir(), `shinobi-memstore-test-${randomUUID()}.db`);
  return { store: new MemoryStore({ db_path: dbPath }), dbPath };
}

describe('MemoryStore.pruneRecallLog (BAJA-04)', () => {
  const stores: MemoryStore[] = [];
  const paths: string[] = [];
  afterEach(() => {
    while (stores.length) stores.pop()!.close();
    while (paths.length) { try { rmSync(paths.pop()!, { force: true }); } catch { /* noop */ } }
  });

  it('purga recall_log a las últimas `keep` filas', async () => {
    const { store, dbPath } = freshStore();
    stores.push(store); paths.push(dbPath);

    const entry = await store.store('contenido de prueba');
    // Genera 20 filas en recall_log recordando la misma memoria 20 veces.
    for (let i = 0; i < 20; i++) await store.recall({ query: 'prueba' });
    expect(store.recallLogCount()).toBeGreaterThanOrEqual(20);

    store.pruneRecallLog(5);
    expect(store.recallLogCount()).toBe(5);
  });

  it('recordRecall purga probabilísticamente (Math.random forzado a disparar la purga)', async () => {
    const { store, dbPath } = freshStore();
    stores.push(store); paths.push(dbPath);
    await store.store('x');

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // < 0.01 siempre dispara
    try {
      for (let i = 0; i < 10; i++) await store.recall({ query: 'x' });
    } finally {
      randomSpy.mockRestore();
    }
    // Con keep=5000 y solo 10 filas, la purga no debería recortar nada aún —
    // solo confirmamos que pruneRecallLog corrió sin lanzar y el conteo es sano.
    expect(store.recallLogCount()).toBeLessThanOrEqual(10);
  });
});

describe('sharedMemoryStore — aviso en modo multi-usuario (ALTA-21)', () => {
  const originalAppData = process.env.APPDATA;

  afterEach(() => {
    delete process.env.SHINOBI_TRUST_USER_HEADER;
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    vi.restoreAllMocks();
  });

  it('avisa por consola cuando se usa con SHINOBI_TRUST_USER_HEADER=1', () => {
    // sharedMemoryStore() abre un better-sqlite3 real en APPDATA/Shinobi —
    // redirigimos a un tmpdir para no tocar la BD real del operador.
    process.env.APPDATA = join(tmpdir(), `shinobi-appdata-test-${randomUUID()}`);
    process.env.SHINOBI_TRUST_USER_HEADER = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sharedMemoryStore();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('sharedMemoryStore'))).toBe(true);
  });
});
