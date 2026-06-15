/**
 * shugyo/explore/reversibility.ts — the anti-destruction mini-boss core (§6.2/§9.2).
 *
 * Reversibility is classified BEFORE executing, by semantics of the affordance.
 * The four containment layers (§9.2): dangerous apps excluded (Chizu), external
 * effects NEVER fired in exploration, destructive only on filler in a revertible
 * cage, everything revertible. This module decides which of the three an action
 * gets. Pure.
 */

import type { Reversibility } from '../types.js';

// "sends to the world" — never fired during exploration (highest concern first).
const EXTERNAL = /\b(send|email|e-mail|post|publish|pay|payment|purchase|checkout|buy|tweet|upload|share|submit|deploy|transfer|wire|invoice|charge|subscribe)\b/i;
// destroys/overwrites local state — only on filler in a revertible cage.
const DESTRUCTIVE = /\b(delete|remove|rm|del|format|wipe|erase|drop|truncate|overwrite|reset|purge|destroy|uninstall|clear|clean)\b/i;
// clearly safe, read/produce-new operations.
const SAFE = /\b(open|list|ls|get|read|view|show|print|help|version|info|status|export|convert|render|describe|search|find|count|preview)\b/i;

/** Classify an affordance's reversibility from its label/signature. */
export function classifyReversibility(label: string, signature = ''): Reversibility {
  const hay = `${label} ${signature}`;
  if (EXTERNAL.test(hay)) return 'external_effect';
  if (DESTRUCTIVE.test(hay)) return 'destructive';
  if (SAFE.test(hay)) return 'reversible';
  return 'unknown';
}

export type ExecutionPolicy = 'probe' | 'filler_only' | 'document_only';

/**
 * What the explorer is allowed to do with an affordance during exploration:
 *   reversible      → probe freely (in the revertible cage)
 *   destructive     → filler_only (only on recognizable filler data, then revert)
 *   external_effect → document_only (NEVER fired — it sends to the world)
 *   unknown         → filler_only (fail-closed: treat as if it could destroy)
 */
export function executionPolicy(r: Reversibility): ExecutionPolicy {
  switch (r) {
    case 'reversible': return 'probe';
    case 'destructive': return 'filler_only';
    case 'external_effect': return 'document_only';
    case 'unknown': return 'filler_only';   // fail-closed
  }
}

/** Hard guard used at the call site: an external_effect must never execute. */
export function mayExecute(r: Reversibility): boolean {
  return executionPolicy(r) !== 'document_only';
}
