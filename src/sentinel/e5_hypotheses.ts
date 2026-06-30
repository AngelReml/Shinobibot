/**
 * E5 — destilación de hipótesis desde claims.
 *
 * Un claim sin dimensión → nota archivada, no se convierte en hipótesis.
 * Varios claims con la misma dimensión → una hipótesis con corroboración.
 * La corroboración (≥2 fuentes independientes) sube la credibilidad a SOLID.
 */

import { createHash } from 'crypto';
import type { E5Claim, E5Dimension, E5Hypothesis, E5CredLevel } from './e5_types.js';

export interface DistillResult {
  hypotheses: E5Hypothesis[];
  /** Claims que no mapearon a ninguna dimensión (notas archivadas). */
  notes: E5Claim[];
}

/** Agrega la credibilidad de un conjunto de claims hacia una hipótesis. */
function aggregateLevel(claims: E5Claim[]): { level: E5CredLevel; score: number } {
  const admissible = claims.filter((c) => c.credibility !== 'UNFOUNDED');
  if (admissible.length === 0) return { level: 'UNFOUNDED', score: 0.1 };

  const hasSolid = admissible.some((c) => c.credibility === 'SOLID');
  const sourcesSet = new Set(admissible.map((c) => c.sourceName));
  const independent = sourcesSet.size;

  // Corroboración: ≥2 fuentes independientes → sube a SOLID.
  if (hasSolid || (independent >= 2 && admissible.length >= 2)) {
    const avgScore = admissible.reduce((s, c) => s + c.credibilityScore, 0) / admissible.length;
    return { level: 'SOLID', score: Math.min(0.95, avgScore + 0.1) };
  }
  const avgScore = admissible.reduce((s, c) => s + c.credibilityScore, 0) / admissible.length;
  return { level: 'PLAUSIBLE', score: avgScore };
}

function hypothesisId(dimension: E5Dimension, claimIds: string[]): string {
  const seed = dimension + ':' + claimIds.sort().join(',');
  return 'h_' + createHash('sha256').update(seed).digest('hex').slice(0, 12);
}

function buildTitle(dimension: E5Dimension, claims: E5Claim[]): string {
  const best = claims.find((c) => c.credibility !== 'UNFOUNDED') ?? claims[0];
  // Usa las primeras palabras del mejor claim como título.
  const words = best.text.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 8).join(' ');
  return `[${dimension}] ${words}`;
}

function buildDescription(dimension: E5Dimension, claims: E5Claim[]): string {
  const parts: string[] = [];
  parts.push(`Hipótesis anclada a la dimensión "${dimension}".`);
  parts.push(`Sustentada por ${claims.length} claim(s) de ${new Set(claims.map((c) => c.sourceName)).size} fuente(s).`);
  const top = claims.slice(0, 2).map((c) => `"${c.quote.slice(0, 80)}..."`).join(' · ');
  if (top) parts.push(`Evidencia: ${top}`);
  return parts.join(' ');
}

/**
 * Destila claims en hipótesis agrupando por dimensión.
 * Claims sin dimensión → notes (archivados, no perseguidos).
 */
export function distillHypotheses(claims: E5Claim[]): DistillResult {
  const byDimension = new Map<E5Dimension, E5Claim[]>();
  const notes: E5Claim[] = [];
  const now = new Date().toISOString();

  for (const c of claims) {
    if (!c.dimension) {
      notes.push(c);
      continue;
    }
    const bucket = byDimension.get(c.dimension) ?? [];
    bucket.push(c);
    byDimension.set(c.dimension, bucket);
  }

  const hypotheses: E5Hypothesis[] = [];
  for (const [dimension, dimClaims] of byDimension.entries()) {
    const { level, score } = aggregateLevel(dimClaims);
    if (level === 'UNFOUNDED') continue; // no generamos hipótesis de señal sin fundamento
    hypotheses.push({
      hypothesisId: hypothesisId(dimension, dimClaims.map((c) => c.claimId)),
      title: buildTitle(dimension, dimClaims),
      description: buildDescription(dimension, dimClaims),
      dimension,
      supportingClaims: dimClaims.map((c) => c.claimId),
      credibility: level,
      credibilityScore: score,
      createdAt: now,
    });
  }

  // Orden: primero SOLID, luego PLAUSIBLE; dentro de cada nivel por score desc.
  hypotheses.sort((a, b) => {
    const levelOrder: Record<E5CredLevel, number> = { SOLID: 2, PLAUSIBLE: 1, UNFOUNDED: 0 };
    const lo = levelOrder[b.credibility] - levelOrder[a.credibility];
    return lo !== 0 ? lo : b.credibilityScore - a.credibilityScore;
  });

  return { hypotheses, notes };
}
