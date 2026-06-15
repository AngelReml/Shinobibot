/**
 * kagami/guard/cracks.ts — Pillar A crack detectors (dossier §6). The fortress is
 * built stone by stone with continuous vigilance and zero silent regressions. The
 * guard VIGILA y REPORTA; it never self-modifies (that goes through the approval
 * gate). Detectors are pure; the Guard.sweep wires them to the real runners.
 *
 * Reuses Shinobi's existing secret scanner (src/security/secret_redactor) — one
 * secrets policy, not a second one.
 */

import { hasSecrets } from '../../security/secret_redactor.js';
import type { Crack, Severity } from '../types.js';

let _seq = 0;
function crackId(): string { return `crack_${++_seq}`; }

/** tracked_secret — a tracked file whose content matches a key/token pattern. Critical. */
export function secretCrack(path: string, content: string, detectedAt: string): Crack | null {
  if (!hasSecrets(content)) return null;
  return { crack_id: crackId(), kind: 'tracked_secret', location: path, severity: 'critical',
    detail: 'tracked file contains what looks like an API key / credential', detected_at: detectedAt };
}

/**
 * regression — a test that PASSED in the previous snapshot and FAILS now. The
 * highest-signal crack (severity high). Pure: compares two name→passed maps.
 */
export function detectRegressions(prev: Record<string, boolean>, curr: Record<string, boolean>, detectedAt: string): Crack[] {
  const out: Crack[] = [];
  for (const [name, passed] of Object.entries(curr)) {
    if (prev[name] === true && passed === false) {
      out.push({ crack_id: crackId(), kind: 'regression', location: name, severity: 'high',
        detail: `test "${name}" passed before and fails now`, detected_at: detectedAt });
    }
  }
  return out;
}

/** untested_module — a module with no tests. low/medium by whether it's in a critical path. */
export function untestedModuleCrack(path: string, criticalPath: boolean, detectedAt: string): Crack {
  return { crack_id: crackId(), kind: 'untested_module', location: path,
    severity: criticalPath ? 'medium' : 'low', detail: 'module has no associated tests', detected_at: detectedAt };
}

/** broken_invariant — a declared system invariant that no longer holds. */
export interface Invariant { name: string; holds: boolean; severity?: Severity; detail?: string; }
export function invariantCracks(invariants: Invariant[], detectedAt: string): Crack[] {
  return invariants.filter((i) => !i.holds).map((i) => ({
    crack_id: crackId(), kind: 'broken_invariant' as const, location: i.name,
    severity: i.severity ?? 'high', detail: i.detail ?? `invariant "${i.name}" is broken`, detected_at: detectedAt,
  }));
}

/** vulnerable_dep — a dependency flagged by audit. */
export function vulnerableDepCrack(dep: string, severity: Severity, detectedAt: string): Crack {
  return { crack_id: crackId(), kind: 'vulnerable_dep', location: dep, severity, detail: `dependency ${dep} has a known vulnerability`, detected_at: detectedAt };
}

export function resetCrackSeq(): void { _seq = 0; }
