/**
 * shugyo/synth/certify.ts — synthesize a learned capability into a skill and
 * certify it in the revertible cage (dossier §11). Here Sello matures: it stops
 * certifying the seed payment skill and starts certifying skills of REAL programs.
 *
 * A capability becomes a LearnedSkill with a manifest (§10: declared_tools,
 * declared_effects, I/O, artifact_hash). It is then run in the cage against an
 * oracle bank; it is CERTIFIED only if it (a) passes every case AND (b) stays
 * within its declared_effects. A skill that "works" but touches something it did
 * NOT declare is NOT certified — the discrimination we learned in Sello FASE A/B,
 * now over real programs. Effects are enforced by the cage's state diff (11.2) —
 * i.e. by comparing filesystem snapshots before/after, NOT by an OS-level sandbox
 * intercepting syscalls while the command runs (see shugyo/sandbox/revertible.ts).
 */

import * as crypto from 'node:crypto';
import { DirCageSandbox } from '../sandbox/revertible.js';
import type { Capability, LearnedSkill, Grade, Provenance } from '../types.js';

export interface SkillManifest {
  skill_id: string;
  declared_tools: string[];
  declared_effects: 'none' | 'read_only' | 'write' | 'irreversible';
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  artifact_hash: string;        // sha256 of the procedure (the exact thing certified)
  command: string;              // the rendered CLI invocation template
}

/** Synthesize a manifest from a learned capability (§11.1). */
export function synthesizeSkill(cap: Capability, opts: { app_id: string; via: 'cli' | 'com' | 'uia' | 'canvas'; command: string; declared_tools: string[]; declared_effects: SkillManifest['declared_effects']; input_schema?: Record<string, unknown>; output_schema?: Record<string, unknown> }): { skill: LearnedSkill; manifest: SkillManifest } {
  const skill_id = `${cap.capability_id}.v1`;
  const artifact = JSON.stringify({ command: opts.command, procedure: cap.procedure });
  const manifest: SkillManifest = {
    skill_id, declared_tools: opts.declared_tools, declared_effects: opts.declared_effects,
    input_schema: opts.input_schema ?? {}, output_schema: opts.output_schema ?? {},
    artifact_hash: `sha256:${crypto.createHash('sha256').update(artifact).digest('hex').slice(0, 24)}`,
    command: opts.command,
  };
  const provenance: Provenance = { origin: 'AGENT_DERIVED', channel: 'shugyo_synthesis', retrieved_at: '', trust_tier: 2, session_seq: 0 };
  const skill: LearnedSkill = { skill_id, app_id: opts.app_id, capability_id: cap.capability_id, manifest_ref: skill_id, status: 'candidate', grade: cap.grade, provenance };
  return { skill, manifest };
}

export interface CertCase {
  case_id: string;
  seed: Record<string, string>;   // files to place in the cage for this case
  /** how the command is run for this case (e.g. with the input filename). */
  command: string;
  expected_stdout: string;        // the oracle
}

export interface CertResult {
  status: 'certified' | 'discarded';
  grade: Grade;
  reason?: string;
  cases: { case_id: string; output_ok: boolean; effects_ok: boolean; passed: boolean; detail: string }[];
}

/** Does a declared effect permit a state change in the cage? */
function effectPermitsChange(effects: SkillManifest['declared_effects']): boolean {
  return effects === 'write' || effects === 'irreversible';
}

/**
 * Certify a skill by running it in the cage against the oracle bank. CERTIFIED iff
 * every case's output matches the oracle AND the observed effect stays within the
 * declared effects (read_only/none ⇒ no cage state change). The cage is reverted
 * between cases (each starts from `fixtures`).
 */
export async function certifyInCage(
  manifest: SkillManifest, cases: CertCase[], cage: DirCageSandbox,
  opts: { fixtures?: Record<string, string>; grade: Grade } = { grade: 'strong' },
): Promise<CertResult> {
  // Base: the fixtures (e.g. a helper script) present in every case.
  for (const [f, c] of Object.entries(opts.fixtures ?? {})) cage.seed(f, c);
  const base = await cage.snapshot();

  const results: CertResult['cases'] = [];
  // try/finally garantiza que la jaula siempre vuelve a `base`, incluso si un caso lanza
  // (oracle vacío, error de ejecución, etc.) — el revert no puede quedar en el happy-path.
  try {
    for (const cs of cases) {
      // oracle vacío ANTES de correr la acción — fail-fast sin contaminar la jaula.
      const oracle = cs.expected_stdout.trim();
      if (oracle.length === 0) throw new Error(`oracle vacío en caso "${cs.case_id}": no se puede certificar`);

      await cage.revert(base);
      for (const [f, c] of Object.entries(cs.seed)) cage.seed(f, c);
      const before = cage.state();
      const r = await cage.runAction({ affordance_id: cs.case_id, kind: 'cli_command', label: manifest.skill_id, signature: cs.command, reversibility: effectPermitsChange(manifest.declared_effects) ? 'destructive' : 'reversible' });
      const after = cage.state();

      const output_ok = r.output.trim().includes(oracle);
      const changed = before.ref !== after.ref;
      // read_only/none must NOT change cage state; write/irreversible may.
      const effects_ok = effectPermitsChange(manifest.declared_effects) ? true : !changed;
      const passed = output_ok && effects_ok;
      results.push({
        case_id: cs.case_id, output_ok, effects_ok, passed,
        detail: passed ? 'ok' : !output_ok ? `output mismatch (got "${r.output.trim().slice(0, 40)}")` : `EFFECTS VIOLATION: declared "${manifest.declared_effects}" but cage state changed`,
      });
    }
  } finally {
    await cage.revert(base);
  }

  const allPass = results.length > 0 && results.every((c) => c.passed);
  const effectsViolated = results.some((c) => !c.effects_ok);
  return {
    status: allPass ? 'certified' : 'discarded',
    grade: opts.grade,
    reason: allPass ? undefined : effectsViolated ? 'se sale de sus efectos declarados — no se certifica aunque funcione' : 'no pasó el banco de oráculos',
    cases: results,
  };
}
