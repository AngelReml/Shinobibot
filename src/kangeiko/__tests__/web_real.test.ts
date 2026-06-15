import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serveDojo, type DojoServer } from '../domains/web/server.js';
import { makeHttpWebRunner } from '../domains/web/runner.js';
import { closedDojoArena, tagTask } from '../domains/web/arena.js';
import { makeWebDomain } from '../domains/web/domain.js';
import { runKangeiko } from '../loop.js';

/**
 * REAL end-to-end: serve the closed-dojo fixtures over local HTTP and run the
 * self-improvement loop against the actually-served HTML. Certification is real —
 * a skill is certified iff the served page yields its oracle. The payment fixture
 * is never fetched (external_effect → documented).
 */
let dojo: DojoServer;
beforeAll(async () => { dojo = await serveDojo(); });
afterAll(async () => { await dojo.close(); });

describe('KG-02/03 real — HTTP runner extracts oracles from the served dojo', () => {
  it('reads the real served page content', async () => {
    const runner = makeHttpWebRunner(dojo.url);
    const arena = closedDojoArena();
    const title = await runner.run(arena.find((t) => t.task_id === 'wt_title')!);
    expect(title.outcome).toContain('Shadow Verifier');
    const price = await runner.run(arena.find((t) => t.task_id === 'wt_price')!);
    expect(price.outcome).toContain('$42.00');
  });
});

describe('KG-03 real — the loop self-improves against the served dojo', () => {
  it('certifies the read skills by ACTUALLY fetching the pages; curve rises to 3/3', async () => {
    const dom = makeWebDomain(closedDojoArena(), makeHttpWebRunner(dojo.url), { baseline: [] });
    const res = await runKangeiko(dom, { maxCycles: 3, maxTokens: 10_000, maxSkillsPerCycle: 3 });
    expect(res.rising).toBe(true);
    expect(res.state.curve[res.state.curve.length - 1].passed).toBe(3);     // all 3 read tasks pass
    expect(dom.repertoireView().sort()).toEqual(['web.read.count', 'web.read.price', 'web.read.title']);
    expect(dom.externalDocumented()).toBeGreaterThanOrEqual(1);             // ⚑ checkout documented, never fetched
  });

  it('certify is REAL: a task whose oracle is absent from the served page is NOT certified', async () => {
    const bogus = [tagTask({ task_id: 'wt_bogus', capability_id: 'web.read.bogus', instruction: 'read a thing', url: 'dojo://fixtures/article.html', oracle: 'THIS-STRING-IS-NOT-ON-THE-PAGE' })];
    const dom = makeWebDomain(bogus, makeHttpWebRunner(dojo.url), { baseline: [] });
    const res = await runKangeiko(dom, { maxCycles: 2, maxTokens: 10_000, maxSkillsPerCycle: 3 });
    expect(dom.repertoireView()).not.toContain('web.read.bogus');   // page doesn't yield the oracle → not certified
    expect(res.rising).toBe(false);
  });
});
