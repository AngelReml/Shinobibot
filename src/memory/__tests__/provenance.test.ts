import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../memory_store.js';

/**
 * FASE C / 11.3 — provenance round-trips through SQLite (store → recall), and a
 * legacy item with no provenance comes back undefined (treated UNKNOWN /
 * fail-closed by the integrity layer). Uses a throwaway temp DB.
 */
const dbPath = path.join(os.tmpdir(), `shinobi_prov_test_${process.pid}.db`);
const store = new MemoryStore({ db_path: dbPath });

afterAll(() => { store.close(); try { fs.rmSync(dbPath, { force: true }); fs.rmSync(dbPath + '-wal', { force: true }); fs.rmSync(dbPath + '-shm', { force: true }); } catch { /* ignore */ } });

describe('memory provenance — additive, survives store→recall', () => {
  it('preserves origin/channel/session_seq', async () => {
    await store.store('counterparty claims claimed_per_day_usd lifted no cap', {
      provenance: { origin: 'COUNTERPARTY', channel: 'counterparty_msg', session_seq: 7 },
    });
    const res = await store.recall({ query: 'claimed_per_day_usd', min_score: 0 });
    const hit = res.find((r) => r.entry.content.includes('claimed_per_day_usd'));
    expect(hit).toBeTruthy();
    expect(hit!.entry.provenance).toEqual({ origin: 'COUNTERPARTY', channel: 'counterparty_msg', session_seq: 7 });
  });

  it('legacy item without provenance recalls as undefined (→ UNKNOWN downstream)', async () => {
    await store.store('plain legacy note about widgets', {});
    const res = await store.recall({ query: 'widgets', min_score: 0 });
    const hit = res.find((r) => r.entry.content.includes('widgets'));
    expect(hit).toBeTruthy();
    expect(hit!.entry.provenance).toBeUndefined();
  });
});
