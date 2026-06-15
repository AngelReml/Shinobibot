/**
 * shugyo/curve/patternbook.ts — the descending curve (dossier §12). Each program
 * learned cheapens the next: a book of transferable idioms ("open_file", "export",
 * "undo"). hit_rate is the thermometer — if it rises, transfer works and the next
 * program costs less; if not, the "learn to learn" promise isn't being met, and we
 * report it honestly. Pure.
 */

import type { TransferablePattern } from '../types.js';

export class PatternBook {
  private patterns = new Map<string, TransferablePattern>();
  private hits = new Map<string, number>();
  private misses = new Map<string, number>();

  constructor(seed: TransferablePattern[] = []) { for (const p of seed) this.patterns.set(p.idiom, p); }

  /** Add or merge a transferable pattern observed in an app. */
  learn(idiom: string, opts: { cues?: string[]; hints?: string[]; seenIn: string }): void {
    const ex = this.patterns.get(idiom);
    if (ex) {
      ex.cues = [...new Set([...ex.cues, ...(opts.cues ?? [])])];
      ex.prior_procedure_hints = [...new Set([...ex.prior_procedure_hints, ...(opts.hints ?? [])])];
      if (!ex.seen_in.includes(opts.seenIn)) ex.seen_in.push(opts.seenIn);
    } else {
      this.patterns.set(idiom, { pattern_id: `pat_${idiom}`, idiom, cues: opts.cues ?? [], prior_procedure_hints: opts.hints ?? [], seen_in: [opts.seenIn], hit_rate: 0 });
    }
  }

  /** Match an idiom in a new app by its cues. Returns the prior to start from. */
  match(observedCues: string[]): TransferablePattern | null {
    const lc = observedCues.map((c) => c.toLowerCase());
    for (const p of this.patterns.values()) {
      if (p.cues.some((c) => lc.includes(c.toLowerCase()))) return p;
    }
    return null;
  }

  /** Record whether a prior accelerated learning, and refresh hit_rate. */
  recordOutcome(idiom: string, accelerated: boolean): void {
    if (accelerated) this.hits.set(idiom, (this.hits.get(idiom) ?? 0) + 1);
    else this.misses.set(idiom, (this.misses.get(idiom) ?? 0) + 1);
    const p = this.patterns.get(idiom);
    if (p) { const h = this.hits.get(idiom) ?? 0, m = this.misses.get(idiom) ?? 0; p.hit_rate = h + m === 0 ? 0 : h / (h + m); }
  }

  get(idiom: string): TransferablePattern | null { return this.patterns.get(idiom) ?? null; }
  all(): TransferablePattern[] { return [...this.patterns.values()]; }
}

/**
 * Is the learning cost actually descending? The promise of the level, MEASURED:
 * each program should cost strictly less than the previous (or it's reported).
 */
export function curveIsDescending(costPerProgram: number[]): boolean {
  for (let i = 1; i < costPerProgram.length; i++) if (costPerProgram[i] >= costPerProgram[i - 1]) return false;
  return costPerProgram.length >= 2;
}
