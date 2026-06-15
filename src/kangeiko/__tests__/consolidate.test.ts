import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidateRepertoire, isDump, type RepertoireEntry } from '../consolidate.js';
import { KangeikoStore } from '../store.js';

function entry(skill_id: string, cap: string, grade: RepertoireEntry['grade'], version: number, at: string, status: RepertoireEntry['status'] = 'active'): RepertoireEntry {
  return { skill_id, capability_id: cap, grade, version, certified_at: at, status };
}

describe('KG-04 — consolidation: the repertoire grows without becoming a dump', () => {
  it('keeps ONE active skill per capability (the best), archives the rest, drops discarded', () => {
    const r = consolidateRepertoire([
      entry('a.v1', 'cap_a', 'medium', 1, '2026-01-01'),
      entry('a.v2', 'cap_a', 'strong', 2, '2026-01-02'),   // better → wins
      entry('b.v1', 'cap_b', 'strong', 1, '2026-01-01'),
      entry('c.v1', 'cap_c', 'experimental', 1, '2026-01-01', 'discarded'), // failed oracle → dropped
    ]);
    expect(r.active.map((e) => e.skill_id).sort()).toEqual(['a.v2', 'b.v1']);
    expect(r.archived.map((e) => e.skill_id)).toEqual(['a.v1']);
    expect(r.dropped.map((e) => e.skill_id)).toEqual(['c.v1']);
    expect(isDump(r.active)).toBe(false);                  // one active per capability
  });

  it('adding a better version keeps the active set = distinct capabilities (no pile-up)', () => {
    let entries = [entry('a.v1', 'cap_a', 'strong', 1, '2026-01-01'), entry('b.v1', 'cap_b', 'strong', 1, '2026-01-01')];
    let res = consolidateRepertoire(entries);
    expect(res.active.length).toBe(2);
    // a v2 arrives for the same capability → v1 archived, active stays 2 (not 3).
    entries = [...res.active, ...res.archived, entry('a.v2', 'cap_a', 'strong', 2, '2026-02-01')];
    res = consolidateRepertoire(entries);
    expect(res.active.length).toBe(2);                     // grew in capability, not in pile
    expect(res.active.find((e) => e.capability_id === 'cap_a')!.skill_id).toBe('a.v2');
    expect(isDump(res.active)).toBe(false);
  });
});

describe('KG-04 — the curve persists across nights', () => {
  const dbPath = path.join(os.tmpdir(), `kk_${process.pid}.db`);
  afterAll(() => { for (const s of ['', '-wal', '-shm']) try { fs.rmSync(dbPath + s, { force: true }); } catch {} });

  it('records curve points and reads them back after reopening the store', () => {
    let store = new KangeikoStore({ db_path: dbPath });
    store.recordCurvePoint('web', { cycle: 1, passed: 1, total: 3 }, '2026-06-15T00:00Z');
    store.recordCurvePoint('web', { cycle: 2, passed: 3, total: 3 }, '2026-06-16T00:00Z');
    store.close();
    // reopen (a new night) — the curve survived.
    store = new KangeikoStore({ db_path: dbPath });
    const curve = store.loadCurve('web');
    expect(curve.map((p) => p.passed)).toEqual([1, 3]);
    // persist a consolidation and read active back.
    store.applyConsolidation(consolidateRepertoire([entry('a.v1', 'cap_a', 'medium', 1, 'x'), entry('a.v2', 'cap_a', 'strong', 2, 'y')]));
    expect(store.listRepertoire('active').map((e) => e.skill_id)).toEqual(['a.v2']);
    expect(store.listRepertoire('archived').map((e) => e.skill_id)).toEqual(['a.v1']);
    store.close();
  });
});
