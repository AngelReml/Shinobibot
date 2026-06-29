// src/integrity/checks.ts
//
// Integrity layer — checks pre/post-acción (claimed==real, hash, tipo) y bloqueo opcional vía SHINOBI_INTEGRITY.
/**
 * integrity/checks.ts — the pre-action integrity checks (C1: 11.1 + 11.2).
 *
 * Pure functions over an IntegrityStep. No I/O except hashing the declared
 * artifact file (11.1) when a path is given. Each returns a CheckResult; the
 * engine aggregates them and applies policy.
 */

import { verifyCsvCertificate, hashArtifactFile } from './csv_verify.js';
import { classifyEffect, effectWithin } from './effects.js';
import { policyAuthority } from './provenance.js';
import type { CheckResult, IntegrityStep, PostActionInput } from './types.js';

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
  // C7 path-scope: protected paths are outside the certified declared scope. The
  // out_of_scope flag is the single protected-path policy (approval.classifyCritical),
  // surfaced here — this is the approval gate's path policy SUBSUMED into 11.2.
  if (skill.effect_scope?.deny_protected && step.action.out_of_scope) {
    return { check: '11.2', ok: false, flag: 'SCOPE_VIOLATION', detail: `action on tool "${tool}" targets a PROTECTED path outside the skill's declared write scope` };
  }
  return { check: '11.2', ok: true, detail: `tool declared + effect "${actualEffect}" ⊆ "${skill.declared_effects}"${skill.effect_scope?.deny_protected ? ' + path in scope' : ''}` };
}

// Heuristic policy-domain phrases (the soft, prose side of 11.3 — labelled).
const POLICY_PHRASES = [
  /no cap/i, /unlimited/i, /sin tope/i, /limit(s)? (lifted|raised|removed|waived)/i,
  /l[íi]mite (especial|sin tope|elevado|anulad)/i, /2fa (verified|ok|pre-?approved)/i,
  /pre-?approved/i, /override/i, /authoriz(ed|ation) (granted|by the)/i,
];

/** Does a context item carry a claim in the policy domain? Structural (key match)
 *  is deterministic; phrase match is heuristic (labelled). */
function carriesPolicyClaim(content: unknown, keys: string[]): { claim: boolean; mode: 'structural' | 'heuristic' } {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    for (const k of Object.keys(content as Record<string, unknown>)) if (keys.includes(k)) return { claim: true, mode: 'structural' };
  }
  const s = (typeof content === 'string' ? content : JSON.stringify(content ?? '')).toLowerCase();
  for (const k of keys) if (k && s.includes(k.toLowerCase())) return { claim: true, mode: 'structural' };
  if (POLICY_PHRASES.some((re) => re.test(s))) return { claim: true, mode: 'heuristic' };
  return { claim: false, mode: 'structural' };
}

/**
 * 11.3 — Memory provenance / poisoning (pre-action, cross-step). Fires iff ALL
 * (CONTRACT §11.3): the action is a PRIVILEGED decision; the decision context
 * has a non-authoritative item carrying a policy-domain claim; honoring it would
 * relax the signed policy (signed says deny); and the action is consistent with
 * honoring it (it authorizes). A non-authoritative item used merely as DATA does
 * NOT fire — only when it is used as AUTHORITY overriding policy.
 */
export function check11_3(step: IntegrityStep): CheckResult {
  if (!step.privileged) return { check: '11.3', ok: true, detail: 'not a privileged decision — nothing to enforce' };
  const conflict = step.signed_policy_outcome === 'deny' && step.action_outcome === 'authorize';
  const keys = step.policy_domain_keys ?? [];
  const items = step.memory_context ?? [];
  const offenders = items
    .map((it) => ({ it, c: carriesPolicyClaim(it.content, keys) }))
    .filter((x) => !policyAuthority(x.it.provenance?.origin) && x.c.claim);
  if (conflict && offenders.length > 0) {
    const o = offenders[0];
    return {
      check: '11.3', ok: false, flag: 'MEMORY_POISON',
      detail: `privileged authorize overrides the signed deny, driven by a non-authoritative ${o.it.provenance.origin} item (channel ${o.it.provenance.channel}, seq ${o.it.provenance.session_seq}, ${o.c.mode}) carrying a policy-domain claim — DATA used as AUTHORITY`,
    };
  }
  return { check: '11.3', ok: true, detail: conflict ? 'authorize-over-deny but no non-authoritative policy claim drives it' : 'no policy conflict, or untrusted item used only as data' };
}

/**
 * 11.4 — Reported == real (post-action). Catches the insidious mode: the agent
 * claims success/a value the tool did not actually produce. Two deterministic
 * triggers:
 *   (a) success-over-failure: the tool really failed (real.success=false) but the
 *       agent's report claims success → fabrication.
 *   (b) claimed-value-absent: the agent asserts a concrete token (`claim`) that
 *       does NOT appear in the tool's real output → fabrication.
 * Reporting a real failure honestly, or a claim grounded in the real output, is ok.
 */
export function check11_4(input: PostActionInput): CheckResult {
  const { real, reported } = input;
  if (!real.success && reported.claims_success) {
    return { check: '11.4', ok: false, flag: 'FABRICATION', detail: `agent reports success but tool "${input.tool}" really failed` };
  }
  if (reported.claim && reported.claim.trim() && !real.output.includes(reported.claim.trim())) {
    return { check: '11.4', ok: false, flag: 'FABRICATION', detail: `agent claims "${reported.claim}" which is absent from the tool's real output` };
  }
  return { check: '11.4', ok: true, detail: 'reported outcome matches the real tool result' };
}
