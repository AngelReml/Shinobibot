/**
 * tenshu/tev_browser.ts — TS-05: ENTENDER. Navigate the verifiable trace (TEV) and
 * reports. The panel doesn't narrate — it lets the operator walk the actual chain of
 * declared-vs-observed effects, grouped by plan/step, and check the chain links. Pure.
 */

import type { TEVEntry } from '../shitsuji/types.js';

/** Filter TEV entries (by step). */
export function browseTev(entries: TEVEntry[], opts: { step_id?: string } = {}): TEVEntry[] {
  return entries.filter((e) => (opts.step_id ? e.step_id === opts.step_id : true));
}

/** A readable, non-narrated view: each step's declared vs observed effects + checks. */
export function tevSummary(entries: TEVEntry[]): string {
  if (!entries.length) return 'TEV vacía (ningún paso con efecto real).';
  const L = [`TEV — ${entries.length} eslabón/es:`];
  for (const e of entries) {
    const checks = e.integrity_checks.map((c) => `${c.check}:${c.verdict}`).join(' ');
    L.push(`  ${e.step_id} · declarado=[${e.declared_effects.join(', ')}] observado=[${e.observed_effects.join(', ')}] · ${checks} · sobre ${e.on_data}`);
  }
  return L.join('\n');
}

export interface ChainVerdict { ok: boolean; length: number; broken_at?: string; }

/** Pure chain-linkage check (genesis→…); the signature check is verifyTevSignature. */
export function verifyTevLinkage(entries: TEVEntry[]): ChainVerdict {
  if (!entries.length) return { ok: true, length: 0 };
  let prev = 'genesis';
  for (const e of entries) {
    if (e.prev_hash !== prev) return { ok: false, length: entries.length, broken_at: e.step_id };
    if (!e.this_hash) return { ok: false, length: entries.length, broken_at: e.step_id };
    prev = e.this_hash;
  }
  return { ok: true, length: entries.length };
}
