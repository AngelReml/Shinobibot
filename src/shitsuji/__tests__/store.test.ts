/**
 * T-02/03 — store (idempotent migrations + persistence + TEV chain verify) and
 * adapters (compile + forward to the real subsystems).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ShitsujiStore } from '../store.js';
import { KangeikoStore } from '../../kangeiko/store.js';
import { certifiedRepertoire, atlasFromCards, requestStepApproval, planNeedsApproval } from '../adapters.js';
import { buildPlan } from '../plan.js';
import { getApprovalMode } from '../../security/approval.js';
import type { Intent, PlanResult } from '../types.js';

const stores: { close(): void }[] = [];
const mem = () => { const s = new ShitsujiStore({ db_path: ':memory:' }); stores.push(s); return s; };
const kmem = () => { const s = new KangeikoStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe('shitsuji/store — T-02 migraciones idempotentes + persistencia', () => {
  it('fresh creates, re-run is a no-op, round-trips intent/plan/result', () => {
    const s = mem();
    // re-running the migration on the same DB must not throw (idempotent)
    expect(() => new ShitsujiStore({ db_path: s.dbPath })).not.toThrow();

    const intent: Intent = { intent_id: 'i1', raw_utterance: 'haz X', goals: [{ goal_id: 'g1', verb: 'hacer', object: 'X', constraints: [] }], references: [], ambiguities: [] };
    s.saveIntent(intent, 't0');
    expect(s.getIntent('i1')?.raw_utterance).toBe('haz X');

    const plan = buildPlan('i1', 'p1', [{ goal_id: 'g1', skill_id: 'x.v1', expected_effect: 'hacer X', reversibility: 'reversible' }]);
    plan.feasible = true;
    s.savePlan(plan, 't1');
    expect(s.getPlan('p1')?.feasible).toBe(true);

    const result: PlanResult = { plan_id: 'p1', status: 'completed', steps: [{ step_id: 's1', status: 'ok', real_effect: 'ok' }], honest_summary: 'Hecho', tev_ref: 'sha256:abc' };
    s.saveResult(result, 't2');
    expect(s.getResult('p1')?.status).toBe('completed');

    // upsert: saving again updates, does not duplicate or throw
    s.saveResult({ ...result, honest_summary: 'Hecho v2' }, 't3');
    expect(s.getResult('p1')?.honest_summary).toBe('Hecho v2');
  });

  it('appends + verifies a well-linked TEV chain (genesis→…)', () => {
    const s = mem();
    s.appendTev('p', [
      { step_id: 's1', declared_effects: ['e1'], observed_effects: ['o1'], on_data: 'd', integrity_checks: [], timestamp: 't', prev_hash: 'genesis', this_hash: 'h1' },
      { step_id: 's2', declared_effects: ['e2'], observed_effects: ['o2'], on_data: 'd', integrity_checks: [], timestamp: 't', prev_hash: 'h1', this_hash: 'h2' },
    ], 't');
    const v = s.verifyTevChain('p');
    expect(v.ok).toBe(true); expect(v.length).toBe(2);
    expect(s.loadTev('p').map((e) => e.step_id)).toEqual(['s1', 's2']);
  });

  it('detects a broken TEV chain (tampered link)', () => {
    const s = mem();
    s.appendTev('p', [
      { step_id: 's1', declared_effects: [], observed_effects: [], on_data: 'd', integrity_checks: [], timestamp: 't', prev_hash: 'genesis', this_hash: 'h1' },
      { step_id: 's2', declared_effects: [], observed_effects: [], on_data: 'd', integrity_checks: [], timestamp: 't', prev_hash: 'WRONG', this_hash: 'h2' },
    ], 't');
    const v = s.verifyTevChain('p');
    expect(v.ok).toBe(false); expect(v.broken_at).toBe('s2');
  });
});

describe('shitsuji/adapters — T-03 ENGANCHE contra firmas reales', () => {
  it('certifiedRepertoire reads the ACTIVE skills from the Kangeiko repertoire', () => {
    const k = kmem();
    k.upsertSkill({ skill_id: 'web.read.v1', capability_id: 'web.read', grade: 'strong', version: 1, certified_at: 't', status: 'active' });
    k.upsertSkill({ skill_id: 'old.v1', capability_id: 'old', grade: 'experimental', version: 1, certified_at: 't', status: 'archived' });
    const rep = certifiedRepertoire(k);
    expect(rep.has('web.read.v1')).toBe(true);
    expect(rep.has('old.v1')).toBe(false);          // archived ≠ active
  });

  it('atlasFromCards builds a queryable Chizu Atlas', () => {
    const atlas = atlasFromCards([]);
    expect(atlas.query()).toEqual([]);
  });

  it('requestStepApproval: reversible step proceeds; planNeedsApproval reflects risk', async () => {
    const plan = buildPlan('i', 'p', [
      { goal_id: 'g1', skill_id: 'r.v1', expected_effect: 'leer', reversibility: 'reversible' },
      { goal_id: 'g2', skill_id: 'w.v1', expected_effect: 'borrar', reversibility: 'irreversible' },
    ]);
    expect(planNeedsApproval(plan)).toBe(true);
    // reversible step never needs the gate → always proceeds, regardless of mode.
    await expect(requestStepApproval(plan.steps[0])).resolves.toBe(true);
    // sanity: the real approval module is wired (mode is a known value).
    expect(['on', 'smart', 'critical', 'off']).toContain(getApprovalMode());
  });
});
