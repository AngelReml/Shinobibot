/**
 * shugyo/curve/patternbook.ts — the descending curve (dossier §12). Each program
 * learned cheapens the next: a book of transferable idioms ("open_file", "export",
 * "undo"). hit_rate is the thermometer — if it rises, transfer works and the next
 * program costs less; if not, the "learn to learn" promise isn't being met, and we
 * report it honestly. Pure.
 *
 * E6 — Diversity budget:
 *   - El corpus tiene un techo (maxPatterns, default 100).
 *   - Idioma nuevo dentro de presupuesto → sube normalmente.
 *   - Idioma nuevo pero corpus lleno: si es demasiado similar (jaccard cues > 0.8)
 *     a uno existente, se descarta (no añade información). Si es distinto, se
 *     evicta el de menor hit_rate para hacer sitio.
 *   - Idioma ya existente (merge) → siempre se actualiza, sin coste de diversidad.
 *
 * Esto garantiza que el corpus siga siendo diverso y accionable, no un vertedero
 * de variaciones sobre el mismo idioma.
 */

import type { TransferablePattern } from '../types.js';

/** Jaccard similarity sobre los cues en minúsculas. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

const DEFAULT_MAX_PATTERNS = 100;
const SIMILARITY_THRESHOLD = 0.8; // jaccard > umbral → el candidato no añade diversidad

export class PatternBook {
  private patterns = new Map<string, TransferablePattern>();
  private hits = new Map<string, number>();
  private misses = new Map<string, number>();
  private readonly maxPatterns: number;

  constructor(seed: TransferablePattern[] = [], opts: { maxPatterns?: number } = {}) {
    this.maxPatterns = opts.maxPatterns ?? DEFAULT_MAX_PATTERNS;
    for (const p of seed) this.patterns.set(p.idiom, p);
  }

  /** Add or merge a transferable pattern observed in an app. */
  learn(idiom: string, opts: { cues?: string[]; hints?: string[]; seenIn: string }): void {
    const ex = this.patterns.get(idiom);
    if (ex) {
      // Merge en idioma existente — siempre permitido, sin coste de diversidad.
      ex.cues = [...new Set([...ex.cues, ...(opts.cues ?? [])])];
      ex.prior_procedure_hints = [...new Set([...ex.prior_procedure_hints, ...(opts.hints ?? [])])];
      if (!ex.seen_in.includes(opts.seenIn)) ex.seen_in.push(opts.seenIn);
      return;
    }

    // Idioma nuevo: aplicar diversity budget.
    const newCues = opts.cues ?? [];

    if (this.patterns.size >= this.maxPatterns) {
      // Corpus lleno: comprobar si el candidato añade diversidad suficiente.
      const tooSimilar = [...this.patterns.values()].some(
        (p) => jaccard(newCues, p.cues) > SIMILARITY_THRESHOLD,
      );
      if (tooSimilar) return; // el corpus ya tiene algo muy similar — descartar

      // Distinto enough: evictar el patrón con hit_rate más bajo para hacer sitio.
      const worst = [...this.patterns.values()].sort((a, b) => a.hit_rate - b.hit_rate)[0];
      if (worst) {
        this.patterns.delete(worst.idiom);
        this.hits.delete(worst.idiom);
        this.misses.delete(worst.idiom);
      }
    }

    this.patterns.set(idiom, {
      pattern_id: `pat_${idiom}`,
      idiom,
      cues: newCues,
      prior_procedure_hints: opts.hints ?? [],
      seen_in: [opts.seenIn],
      hit_rate: 0,
    });
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
