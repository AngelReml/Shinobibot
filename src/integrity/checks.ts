/**
 * integrity/checks.ts — the pre-action integrity checks (C1: 11.1 + 11.2).
 *
 * Pure functions over an IntegrityStep. No I/O except hashing the declared
 * artifact file (11.1) when a path is given. Each returns a CheckResult; the
 * engine aggregates them and applies policy.
 */

import { verifyCsvCertificate, hashArtifactFile } from './csv_verify.js';
import { classifyEffect, effectWithin } from './effects.js';
import type { CheckResult, IntegrityStep } from './types.js';

/**
 * 11.1 — Skill with a valid certificate (pre-action).
 * No skill / no CSV → UNVERIFIED_SKILL. CSV present → verify signature + this_hash
 * + CERTIFIED; if an artifact_path is bound, the on-disk artifact must hash to the
 * certificate's skill_artifact_hash (binds the cert to the exact code that runs).
 */
export function check11_1(step: IntegrityStep): CheckResult {
  const skill = step.skill;
  if (!skill || !skill.csv) {
    return { check: '11.1', ok: false, flag: 'UNVERIFIED_SKILL', detail: skill ? `skill ${skill.skill_id} has no CSV attached` : 'action not backed by a certified skill' };
  }
  const v = verifyCsvCertificate(skill.csv);
  if (!v.ok) {
    return { check: '11.1', ok: false, flag: 'CSV_INVALID', detail: `CSV invalid: ${v.reasons.join('; ')}` };
  }
  if (skill.artifact_path) {
    let actual: string;
    try { actual = hashArtifactFile(skill.artifact_path); }
    catch (e: any) { return { check: '11.1', ok: false, flag: 'ARTIFACT_MISMATCH', detail: `cannot hash artifact ${skill.artifact_path}: ${e.message}` }; }
    if (actual !== v.skill_artifact_hash) {
      return { check: '11.1', ok: false, flag: 'ARTIFACT_MISMATCH', detail: `on-disk artifact ${actual} != certified ${v.skill_artifact_hash}` };
    }
  }
  return { check: '11.1', ok: true, detail: `CSV valid + CERTIFIED${skill.artifact_path ? ' + artifact hash matches' : ''}` };
}

/**
 * 11.2 — Action ⊆ declared effects/tools (pre-action). declared_effects gains
 * enforcement here. The tool must be in declared_tools (empty list = no tools
 * allowed) and its classified effect must not exceed declared_effects.
 */
export function check11_2(step: IntegrityStep): CheckResult {
  const skill = step.skill;
  if (!skill) {
    // No skill to declare bounds; 11.1 already flagged. Nothing to enforce here.
    return { check: '11.2', ok: true, detail: 'no skill binding — no declared bounds to enforce' };
  }
  const tool = step.action.tool;
  if (!skill.declared_tools.includes(tool)) {
    return { check: '11.2', ok: false, flag: 'TOOL_NOT_DECLARED', detail: `tool "${tool}" not in declared_tools [${skill.declared_tools.join(', ') || '∅'}]` };
  }
  const actualEffect = classifyEffect(tool);
  if (!effectWithin(actualEffect, skill.declared_effects)) {
    return { check: '11.2', ok: false, flag: 'EFFECTS_VIOLATION', detail: `action effect "${actualEffect}" exceeds declared_effects "${skill.declared_effects}"` };
  }
  return { check: '11.2', ok: true, detail: `tool declared + effect "${actualEffect}" ⊆ "${skill.declared_effects}"` };
}
