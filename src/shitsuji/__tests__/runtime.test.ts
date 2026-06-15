/**
 * T-08 — real execution under Capa 2, on copies/snapshots, with transfer (⚑).
 * Drives runPlan() with the live executor; the live skill invocation is faked so
 * the SAFETY WRAPPER (copy isolation, Capa 2 11.2/11.4, external-never-fired,
 * revert, transfer) is exercised deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DirCageSandbox } from '../../shugyo/sandbox/revertible.js';
import { buildPlan, type StepSpec } from '../plan.js';
import { checkFeasibility } from '../feasibility.js';
import { runPlan } from '../execute.js';
import { makeRealExecutor, type SkillInvoker } from '../runtime.js';
import type { PlanStep } from '../types.js';

const newCage = () => new DirCageSandbox();

describe('shitsuji/runtime — T-08 ejecución real bajo Capa 2 (⚑)', () => {
  it('happy path: runs each step on a COPY in the cage, transfers artifact downstream, no real-world commit by default', async () => {
    const specs: StepSpec[] = [
      { goal_id: 'g1', skill_id: 'doc.extract.v1', expected_effect: 'extraer texto', reversibility: 'reversible' },
      { goal_id: 'g2', skill_id: 'doc.summarize.v1', expected_effect: 'resumir', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'p', specs, [{ from_step: 's1', to_step: 's2', artifact: 'text.txt' }]);
    checkFeasibility(plan, ['doc.extract.v1', 'doc.summarize.v1']);

    const cage = newCage();
    const seen: Record<string, string | undefined> = {};
    const invoke: SkillInvoker = async (step, ctx) => {
      seen[step.step_id] = ctx.upstream['s1'];          // s2 should see s1's artifact
      if (step.step_id === 's1') { fs.writeFileSync(path.join(ctx.workDir, 'text.txt'), 'hola'); return { success: true, output: 'extraído', artifact: 'text.txt' }; }
      return { success: true, output: 'resumido' };
    };
    const commit = vi.fn();
    const exec = makeRealExecutor({ invoke, commit, approved: [], ts: 't', cage });

    const res = await runPlan(plan, exec);
    expect(res.status).toBe('completed');
    expect(res.steps.find((s) => s.step_id === 's1')!.artifact_out).toBe('text.txt');
    expect(seen['s2']).toBe('text.txt');                 // (4) transfer worked
    // reversible steps that don't require approval may commit; here commit is provided so it runs
    expect(commit).toHaveBeenCalledTimes(2);
    await exec.close();
  });

  it('⚑ external_effect step is DOCUMENTED, never invoked — even when approved', async () => {
    const specs: StepSpec[] = [{ goal_id: 'g1', skill_id: 'pay.send.v1', expected_effect: 'pagar la factura', reversibility: 'external_effect' }];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, ['pay.send.v1']);
    const invoke = vi.fn<SkillInvoker>(async () => ({ success: true, output: 'PAID' }));
    const exec = makeRealExecutor({ invoke, approved: ['s1'], ts: 't', cage: newCage() });

    const res = await runPlan(plan, exec);
    expect(invoke).not.toHaveBeenCalled();               // never fired ⚑
    expect(res.steps[0].status).toBe('skipped');
    expect(res.steps[0].real_effect).toMatch(/DOCUMENTADO, no disparado/);
    await exec.close();
  });

  it('⚑ Capa 2 11.2: a read_only-declared step that mutates the cage FAILS (effects violation), real data untouched', async () => {
    const specs: StepSpec[] = [{ goal_id: 'g1', skill_id: 'fs.read.v1', expected_effect: 'leer', reversibility: 'reversible' }];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, ['fs.read.v1']);
    const cage = newCage();
    const invoke: SkillInvoker = async (_s, ctx) => { fs.writeFileSync(path.join(ctx.workDir, 'sneaky.txt'), 'x'); return { success: true, output: 'leído' }; };
    // declare this step read_only → the write must be caught.
    const exec = makeRealExecutor({ invoke, declaredEffect: () => 'read_only', approved: [], ts: 't', cage });

    const res = await runPlan(plan, exec);
    expect(res.steps[0].status).toBe('failed');
    expect(res.steps[0].real_effect).toMatch(/EFFECTS_VIOLATION/);
    await exec.close();
  });

  it('⚑ Capa 2 11.4: a skill that reports success it did NOT achieve FAILS (no fabrication)', async () => {
    const specs: StepSpec[] = [{ goal_id: 'g1', skill_id: 'x.v1', expected_effect: 'hacer', reversibility: 'reversible' }];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, ['x.v1']);
    const invoke: SkillInvoker = async () => ({ success: false, claims_success: true, output: 'falló de verdad' });
    const exec = makeRealExecutor({ invoke, approved: [], ts: 't', cage: newCage() });

    const res = await runPlan(plan, exec);
    expect(res.steps[0].status).toBe('failed');
    expect(res.steps[0].real_effect).toMatch(/FABRICATION|reports success/i);
    await exec.close();
  });

  it('snapshot/revert: a mid-plan failure reverts the committed reversible step (real-world undo called) and leaves the cage clean', async () => {
    const specs: StepSpec[] = [
      { goal_id: 'g1', skill_id: 'a.v1', expected_effect: 'paso 1', reversibility: 'reversible' },
      { goal_id: 'g2', skill_id: 'b.v1', expected_effect: 'paso 2', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, ['a.v1', 'b.v1']);
    const cage = newCage();
    const invoke: SkillInvoker = async (step, ctx) => {
      if (step.step_id === 's1') { fs.writeFileSync(path.join(ctx.workDir, 'out1.txt'), 'r1'); return { success: true, output: 'ok1', artifact: 'out1.txt' }; }
      return { success: false, output: 'paso 2 reventó' };       // s2 fails → no-blind stop + revert s1
    };
    const commit = vi.fn(); const uncommit = vi.fn();
    const exec = makeRealExecutor({ invoke, commit, uncommit, approved: [], ts: 't', cage });

    const res = await runPlan(plan, exec);
    expect(res.steps.find((s) => s.step_id === 's1')!.status).toBe('rolled_back');
    expect(uncommit).toHaveBeenCalledTimes(1);           // the committed step was undone in the real world ⚑
    expect(res.status).toBe('aborted');                  // s1 reverted → nothing stands
    // cage left clean: out1.txt was reverted away
    expect(fs.existsSync(path.join(cage.workDir, 'out1.txt'))).toBe(false);
    await exec.close();
  });
});
