import { describe, it, expect, vi } from 'vitest';
import { shitsujiEnabled } from '../config.js';
import { buildPlan, renderPlan, type StepSpec } from '../plan.js';
import { checkFeasibility } from '../feasibility.js';
import { unapproved, approvalsNeeded } from '../approval.js';
import { runPlan, assertNoFabrication, type ExecuteDeps } from '../execute.js';
import type { PlanStep, StepResult } from '../types.js';

const specs: StepSpec[] = [
  { goal_id: 'g1', skill_id: 'fs.read.v1', expected_effect: 'leer el fichero', reversibility: 'reversible' },
  { goal_id: 'g2', skill_id: 'img.edit.v1', expected_effect: 'editar la imagen', reversibility: 'irreversible' },
  { goal_id: 'g3', skill_id: 'mail.send.v1', expected_effect: 'enviar el resultado', reversibility: 'external_effect' },
];

describe('shitsuji — flag + plan', () => {
  it('SHITSUJI_ENABLED default off', () => { expect(shitsujiEnabled()).toBe(false); });
  it('buildPlan derives approval/on_copy from reversibility + risk summary; renders ⚑', () => {
    const plan = buildPlan('i1', 'p1', specs);
    expect(plan.steps[0].requires_approval).toBe(false);        // reversible
    expect(plan.steps[1].requires_approval).toBe(true);         // irreversible → approval + on_copy
    expect(plan.steps[1].on_copy).toBe(true);
    expect(plan.risk_summary).toEqual({ irreversible_steps: 1, external_effect_steps: 1 });
    expect(renderPlan(plan)).toContain('⚑');
    expect(approvalsNeeded(plan)).toEqual(['s2', 's3']);
  });
});

describe('shitsuji — feasibility (declina lo que no domina, no improvisa)', () => {
  it('all skills certified → feasible', () => {
    const plan = buildPlan('i1', 'p1', specs);
    const r = checkFeasibility(plan, ['fs.read.v1', 'img.edit.v1', 'mail.send.v1']);
    expect(r.feasible).toBe(true); expect(r.missing_skills).toEqual([]);
  });
  it('a missing skill → not feasible + precise decline', () => {
    const plan = buildPlan('i1', 'p1', specs);
    const r = checkFeasibility(plan, ['fs.read.v1', 'mail.send.v1']);   // img.edit.v1 missing
    expect(r.feasible).toBe(false);
    expect(r.missing_skills).toContain('img.edit.v1');
    expect(r.decline_message).toMatch(/no lo domino|no lo voy a improvisar/i);
  });
});

describe('shitsuji — execution: armor on (⚑)', () => {
  const okRunner = (step: PlanStep): Promise<StepResult> => Promise.resolve({ step_id: step.step_id, status: 'ok', real_effect: `did ${step.expected_effect}` });

  it('feasible + approved + all ok → completed, honest "Hecho", no fabrication', async () => {
    const plan = buildPlan('i', 'p', specs); checkFeasibility(plan, ['fs.read.v1', 'img.edit.v1', 'mail.send.v1']);
    const res = await runPlan(plan, { runStep: okRunner, approved: new Set(['s2', 's3']), ts: 't' });
    expect(res.status).toBe('completed');
    expect(res.honest_summary).toMatch(/hecho/i);
    expect(assertNoFabrication(res)).toBe(true);
    expect(res.tev_ref).toBeTruthy();
  });

  it('infeasible → aborted, never touches data, NOT completed', async () => {
    const plan = buildPlan('i', 'p', specs); checkFeasibility(plan, ['fs.read.v1']);  // 2 missing
    const runStep = vi.fn(okRunner);
    const res = await runPlan(plan, { runStep, approved: new Set(['s2', 's3']), ts: 't' });
    expect(res.status).toBe('aborted');
    expect(runStep).not.toHaveBeenCalled();              // nothing executed
    expect(res.honest_summary).toMatch(/no factible/i);
  });

  it('required-approval step not approved → blocked, never run (⚑)', async () => {
    const plan = buildPlan('i', 'p', specs); checkFeasibility(plan, ['fs.read.v1', 'img.edit.v1', 'mail.send.v1']);
    const runStep = vi.fn(okRunner);
    // approve nothing → s2 (irreversible) blocks after s1 runs.
    const res = await runPlan(plan, { runStep, approved: new Set<string>(), ts: 't' });
    expect(runStep).toHaveBeenCalledTimes(1);            // only s1 (reversible) ran; s2 blocked
    expect(res.status).not.toBe('completed');
    expect(res.honest_summary).toMatch(/aprobaci/i);
    expect(unapproved(plan, [])).toEqual(['s2', 's3']);
  });

  it('FALLO NO-CIEGO: a mid-plan failure stops, reverts the reversible, reports the real state — never "completed"', async () => {
    const plan = buildPlan('i', 'p', specs); checkFeasibility(plan, ['fs.read.v1', 'img.edit.v1', 'mail.send.v1']);
    const reverted: string[] = [];
    const runStep = vi.fn(async (step: PlanStep): Promise<StepResult> => {
      if (step.step_id === 's2') return { step_id: 's2', status: 'failed', real_effect: 'editor crashed' };
      return { step_id: step.step_id, status: 'ok', real_effect: 'ok' };
    });
    const revert = vi.fn(async (step: PlanStep) => { reverted.push(step.step_id); });
    const res = await runPlan(plan, { runStep, revert, approved: new Set(['s2', 's3']), ts: 't' });
    expect(runStep).toHaveBeenCalledTimes(2);            // s1 ok, s2 failed → STOPPED (s3 never ran)
    expect(reverted).toContain('s1');                    // the reversible step was undone
    // s1 reverted → nothing stands → honest net state is 'aborted' (world unchanged), not a fake 'partial'.
    expect(res.status).toBe('aborted');
    expect(res.honest_summary).toMatch(/NO está completado/i);
    expect(res.steps.find((s) => s.step_id === 's3')!.status).toBe('skipped');
    expect(assertNoFabrication(res)).toBe(true);         // does not claim success
  });
});
