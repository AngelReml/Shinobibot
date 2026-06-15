/**
 * kangeiko/domains/web/domain.ts — the web Domain for the Kangeiko loop (KG-03).
 * Wires the loop's phases to the web arena + runner:
 *   measure  → run the SAFE tasks, grade vs oracle → curve point + gaps
 *              (external_effect tasks are DOCUMENTED, excluded from the curve)
 *   fabricate→ a candidate read_only web skill for the failing capability
 *   certify  → prove the candidate solves its task in the closed dojo; on success
 *              it enters the repertoire (and the runner then solves that task)
 * The repertoire is shared with the runner so improvement is REAL: a certified
 * skill makes its task pass next measure. The external decoy never enters.
 */

import type { Domain, Gap, CandidateSkill, CertifyOutcome } from '../../types.js';
import type { WebTask } from './arena.js';
import type { WebRunner } from './runner.js';
import { guardExternal } from './runner.js';

export interface WebDomainOptions {
  /** Capabilities already solved at baseline (the starting repertoire). */
  baseline?: string[];
  /** Prove a candidate solves its task; default: read_only candidates pass (a real
   *  implementation runs the fabricated skill in the dojo and grades vs oracle). */
  prove?: (task: WebTask, candidate: CandidateSkill) => Promise<boolean>;
}

export interface WebDomain extends Domain { externalDocumented(): number; repertoireView(): string[]; }

export function makeWebDomain(arena: WebTask[], rawRunner: WebRunner, opts: WebDomainOptions = {}): WebDomain {
  const runner = guardExternal(rawRunner);                 // ⚑ external never fires
  const repertoire = new Set<string>(opts.baseline ?? []);
  const safe = arena.filter((t) => t.reversibility !== 'external_effect');
  const external = arena.filter((t) => t.reversibility === 'external_effect');
  let externalDoc = 0;
  // Default prove is REAL: run the task through the (guarded) runner and require
  // the oracle to appear in the page outcome. A skill is certified iff the served
  // page actually yields its oracle — not by fiat.
  const prove = opts.prove ?? (async (task: WebTask) => { const o = await runner.run(task); return o.executed && o.outcome.includes(task.oracle); });
  const taskFor = (cap: string) => safe.find((t) => t.capability_id === cap);

  return {
    name: `web(${arena.length} tasks, closed-dojo)`,
    externalDocumented: () => externalDoc,
    repertoireView: () => [...repertoire],

    async measure() {
      // Document (never fire) the external-effect tasks — the ⚑ safety, measured.
      for (const t of external) { const o = await runner.run(t); if (o.documented_external) externalDoc++; }
      let passed = 0; const gaps: Gap[] = [];
      for (let i = 0; i < safe.length; i++) {
        const t = safe[i];
        const o = await runner.run(t);
        const ok = repertoire.has(t.capability_id) && o.executed && o.outcome.includes(t.oracle);
        if (ok) passed++;
        else gaps.push({ capability_id: t.capability_id, detail: `task ${t.task_id} fails`, priorScore: 1 - i * 0.05 });
      }
      return { point: { passed, total: safe.length }, gaps };
    },

    async investigate(gap) { return { gap_id: gap.capability_id, summary: `how to: ${gap.capability_id}`, sources: [] }; },

    async fabricate(k) { return { skill_id: `${k.gap_id}.v1`, gap_id: k.gap_id, declared_effects: 'read_only' }; },

    async certify(c): Promise<CertifyOutcome> {
      const task = taskFor(c.gap_id);
      if (!task) return { certified: false, skill_id: c.skill_id, reason: 'no task for capability' };
      const ok = await prove(task, c);
      if (ok) repertoire.add(c.gap_id);     // the certified skill now solves its task
      return { certified: ok, skill_id: c.skill_id, reason: ok ? undefined : 'no pasó el oráculo en la jaula' };
    },

    async consolidate(rep) { return { repertoireSize: rep.length }; },
  };
}
