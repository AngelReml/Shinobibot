import { describe, it, expect } from 'vitest';
import { kangeikoEnabled } from '../config.js';
import { runKangeiko } from '../loop.js';
import { curveRising } from '../curve.js';
import type { Domain, Gap } from '../types.js';

/**
 * A stateful stub domain: 5 capabilities, baseline 2 pass. cap_1/cap_2 certify
 * (curve rises); cap_3 always FAILS its oracle (discarded, never counted) — the
 * certification gate. A real domain wires measure→Kagami, fabricate→Shugyō,
 * certify→Sello/certifyInCage.
 */
function improvingDomain(): Domain {
  const total = 5; const baseline = 2;
  const certified = new Set<string>();
  const gapsFor = (): Gap[] => ['cap_1', 'cap_2', 'cap_3'].filter((c) => !certified.has(c)).map((c, i) => ({ capability_id: c, detail: `${c} fails`, priorScore: 1 - i * 0.1 }));
  return {
    name: 'stub',
    async measure() { return { point: { passed: baseline + certified.size, total }, gaps: gapsFor() }; },
    async investigate(gap) { return { gap_id: gap.capability_id, summary: 'how', sources: [] }; },
    async fabricate(k) { return { skill_id: `${k.gap_id}.skill`, gap_id: k.gap_id, declared_effects: 'read_only' }; },
    async certify(c) {
      const ok = c.gap_id !== 'cap_3';      // cap_3 never passes the oracle
      if (ok) certified.add(c.gap_id);
      return { certified: ok, skill_id: c.skill_id, reason: ok ? undefined : 'no pasó el oráculo' };
    },
    async consolidate(rep) { return { repertoireSize: rep.length }; },
  };
}

function flatDomain(): Domain {
  const d = improvingDomain();
  return { ...d, async certify(c) { return { certified: false, skill_id: c.skill_id, reason: 'nada pasa' }; } };
}

describe('kangeiko — flag', () => {
  it('KANGEIKO_ENABLED default off', () => { expect(kangeikoEnabled()).toBe(false); });
});

describe('KG-01 — the self-improvement loop over a verifiable domain', () => {
  it('the certified curve RISES, and only certified skills enter the repertoire', async () => {
    const r = await runKangeiko(improvingDomain(), { maxCycles: 3, maxTokens: 10_000, maxSkillsPerCycle: 3 });
    expect(r.state.curve.length).toBeGreaterThanOrEqual(2);
    expect(r.rising).toBe(true);
    expect(r.delta).toBeGreaterThan(0);
    // cap_1 & cap_2 certified; cap_3 discarded (failed oracle), never in the repertoire.
    expect(r.state.repertoire.sort()).toEqual(['cap_1.skill', 'cap_2.skill']);
    expect(r.state.repertoire).not.toContain('cap_3.skill');
    expect(r.state.discarded).toContain('cap_3.skill');
    expect(r.state.curve[r.state.curve.length - 1].passed).toBe(4);   // 2 baseline + 2 certified
  });

  it('honest when there is no improvement: curve does NOT rise, repertoire stays empty', async () => {
    const r = await runKangeiko(flatDomain(), { maxCycles: 3, maxTokens: 10_000, maxSkillsPerCycle: 3 });
    expect(r.rising).toBe(false);              // no fabrication of progress
    expect(r.state.repertoire.length).toBe(0); // nothing certified → repertoire empty
    expect(r.state.discarded.length).toBeGreaterThan(0);
  });

  it('budget bounds the loop (maxTokens stops it early)', async () => {
    const persisted: number[] = [];
    const r = await runKangeiko(improvingDomain(), { maxCycles: 99, maxTokens: 30, maxSkillsPerCycle: 3 }, { persist: (s) => persisted.push(s.tokensSpent) });
    expect(r.state.tokensSpent).toBeLessThanOrEqual(60);   // stopped near the cap, didn't run 99 cycles
    expect(r.state.cycle).toBeLessThan(99);
  });

  it('curveRising rejects a regression', () => {
    expect(curveRising([{ cycle: 1, passed: 4, total: 5 }, { cycle: 2, passed: 2, total: 5 }])).toBe(false);
  });
});
