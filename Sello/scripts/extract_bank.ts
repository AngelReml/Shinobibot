/**
 * scripts/extract_bank.ts — extract the 30 REAL tasks verbatim (CONTRACT §4).
 *
 * Source of truth: vendor/opengravity/banco/pilot_agentic_v1_bvp.ts (copied
 * verbatim from OpenGravity/legacy/src/banco/tasks/pilot_agentic_v1_bvp.ts).
 * NO reconstruction: every field is read straight off the source AgenticTask.
 *
 * Routing (OpenGravity's documented BVP routing):
 *   non-adversarial → bvp_behavioral   (reads expected_output_schema /
 *                                        mandatory_actions / forbidden_actions /
 *                                        verdict_dimensions)
 *   adversarial     → safety_refusal    (built-in refusal-keyword detection)
 *
 * oracle_output is left null here; scripts/compute_oracles.ts computes it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_AGENTIC_V1_BVP } from '../vendor/opengravity/banco/pilot_agentic_v1_bvp.ts';
import type { BankTask } from '../src/harness/bank.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../bank/pilot_agentic_v1.jsonl');

const lines: BankTask[] = PILOT_AGENTIC_V1_BVP.map((t) => {
  const grader = t.is_adversarial ? 'safety_refusal' : 'bvp_behavioral';
  const grader_config = t.is_adversarial
    ? {}
    : {
        expected_output_schema: t.ground_truth.expected_output_schema,
        mandatory_actions: t.ground_truth.mandatory_actions,
        forbidden_actions: t.ground_truth.forbidden_actions,
        verdict_dimensions: t.verdict_dimensions,
      };
  return {
    task_id: t.id,
    category: t.category,
    name: t.id,
    grader,
    grader_config,
    mode: 'clean',
    input: { prompt: t.prompt },
    oracle_output: null,
    oracle_type: 'valid_set',
    adversarial: t.is_adversarial,
    added_version: 'v1.0',
  } satisfies BankTask;
});

// ── Invariants (fail loud if the source drifted) ──────────────────────────
if (lines.length !== 30) throw new Error(`expected 30 tasks, got ${lines.length}`);
const cats = new Map<string, number>();
for (const l of lines) cats.set(l.category, (cats.get(l.category) ?? 0) + 1);
if (cats.size !== 6) throw new Error(`expected 6 categories, got ${cats.size}: ${[...cats.keys()].join(', ')}`);
const adversarial = lines.filter((l) => l.adversarial).length;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

console.log(`✓ wrote ${lines.length} tasks → ${outPath}`);
console.log(`  categories: ${[...cats.entries()].map(([c, n]) => `${c}=${n}`).join(', ')}`);
console.log(`  adversarial: ${adversarial} (→ safety_refusal), non-adversarial: ${lines.length - adversarial} (→ bvp_behavioral)`);
console.log(`  oracle_output: null for all (run compute_oracles next)`);
