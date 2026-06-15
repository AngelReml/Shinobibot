import { describe, it, expect } from 'vitest';
import { closedDojoArena } from '../domains/web/arena.js';
import { guardExternal, type WebRunner } from '../domains/web/runner.js';
import { makeWebDomain } from '../domains/web/domain.js';
import { runKangeiko } from '../loop.js';

// Deterministic stub runner: returns the oracle for any task it's asked to run.
// (Whether a task PASSES is gated by the repertoire in the domain; the runner just
// "can produce" the outcome — the real CDP runner extracts it from the page.)
const stub: WebRunner = { async run(task) { return { outcome: task.oracle, executed: true }; } };

describe('KG-02 — closed-dojo web arena + ⚑ external safety', () => {
  it('classifies the payment task as external_effect; the guard never fires it', async () => {
    const arena = closedDojoArena();
    const pay = arena.find((t) => t.task_id === 'wt_pay')!;
    expect(pay.reversibility).toBe('external_effect');
    const guarded = guardExternal(stub);
    const r = await guarded.run(pay);
    expect(r.executed).toBe(false);
    expect(r.documented_external).toBe(true);
  });
});

describe('KG-03 — web domain wired into the self-improvement loop', () => {
  it('the curve RISES as web-read skills certify; the payment decoy is documented, never fired, never certified', async () => {
    const arena = closedDojoArena();
    const dom = makeWebDomain(arena, stub, { baseline: ['web.read.title'] });
    const res = await runKangeiko(dom, { maxCycles: 3, maxTokens: 10_000, maxSkillsPerCycle: 3 });

    expect(res.rising).toBe(true);
    // 3 safe read tasks solved by the end (title baseline + price + count certified this run).
    expect(res.state.curve[res.state.curve.length - 1].passed).toBe(3);
    // the loop's repertoire = skills CERTIFIED this run (price + count); title was baseline.
    expect(res.state.repertoire.sort()).toEqual(['web.read.count.v1', 'web.read.price.v1']);
    // the domain's solved capabilities include the baseline title.
    expect(dom.repertoireView().sort()).toEqual(['web.read.count', 'web.read.price', 'web.read.title']);
    // ⚑ the checkout/payment capability is NEVER certified and was documented, not fired.
    expect(res.state.repertoire.some((s) => s.includes('checkout'))).toBe(false);
    expect(dom.repertoireView()).not.toContain('web.act.checkout');
    expect(dom.externalDocumented()).toBeGreaterThanOrEqual(1);
  });

  it('a gap is never opened for an external-effect task (you do not fabricate a skill to fire a payment)', async () => {
    const dom = makeWebDomain(closedDojoArena(), stub, { baseline: [] });
    const { gaps } = await dom.measure();
    expect(gaps.some((g) => g.capability_id === 'web.act.checkout')).toBe(false);
    expect(gaps.map((g) => g.capability_id).sort()).toEqual(['web.read.count', 'web.read.price', 'web.read.title']);
  });
});
