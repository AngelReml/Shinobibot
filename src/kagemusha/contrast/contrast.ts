/**
 * kagemusha/contrast/contrast.ts — map a finding to a module + verdict (§9.2).
 *
 * Deterministic ranking by keyword overlap between the finding and each unit's
 * capability_summary (semantic embeddings can enrich, but token overlap is honest
 * and testable with fixtures). The SIRVE/YA_LO_TENEMOS/MEJOR_QUE_NOSOTROS
 * distinction is genuinely a judgment call → an injectable judge; the deterministic
 * fallback gives a defensible verdict + confidence. Low confidence → suggestion,
 * not assertion (§9.3).
 */

import type { CodebaseUnit, ContrastVerdict, ContrastLabel } from '../types.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'with', 'on', 'is', 'it', 'this', 'that', 'de', 'la', 'el', 'un', 'una', 'que', 'por', 'con', 'en']);

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2 && !STOP.has(t)));
}

/** Jaccard-ish overlap of significant tokens (0..1). */
export function overlapScore(findingText: string, unit: CodebaseUnit): number {
  const a = tokens(findingText);
  const b = tokens(`${unit.symbol} ${unit.capability_summary} ${unit.path}`);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export type ContrastJudge = (findingText: string, unit: CodebaseUnit, overlap: number) => { verdict: ContrastLabel; rationale: string } | null;

/** F5 — variante async del juez, para jueces LLM (kageLLM). Mismo contrato: null → fallback determinista. */
export type AsyncContrastJudge = (findingText: string, unit: CodebaseUnit, overlap: number) => Promise<{ verdict: ContrastLabel; rationale: string } | null>;

export interface ContrastOptions { judge?: ContrastJudge; minOverlap?: number; }

/** Núcleo compartido: mejor unidad candidata por solape (determinista). */
function bestMatch(findingText: string, units: CodebaseUnit[]): { best: CodebaseUnit | null; bestScore: number } {
  let best: CodebaseUnit | null = null, bestScore = 0;
  for (const u of units) { const s = overlapScore(findingText, u); if (s > bestScore) { bestScore = s; best = u; } }
  return { best, bestScore };
}

/** Núcleo compartido: veredicto determinista de fallback. */
function deterministicVerdict(findingRef: string, best: CodebaseUnit, bestScore: number): ContrastVerdict {
  const verdict: ContrastLabel = bestScore >= 0.5 ? 'YA_LO_TENEMOS' : 'SIRVE';
  const rationale = verdict === 'YA_LO_TENEMOS'
    ? `alto solape con ${best.symbol} (${best.path}) — probablemente ya lo hacemos`
    : `relacionado con ${best.symbol} (${best.path}) — aplicable`;
  return { finding_ref: findingRef, verdict, codebase_unit: best.path, rationale, confidence: bestScore };
}

function irrelevant(findingRef: string, bestScore: number): ContrastVerdict {
  return { finding_ref: findingRef, verdict: 'IRRELEVANTE', rationale: 'sin solape relevante con el código existente', confidence: 1 - bestScore };
}

/** Map a finding to its best-matching module + a ContrastVerdict. */
export function mapFindingToModule(findingRef: string, findingText: string, units: CodebaseUnit[], opts: ContrastOptions = {}): ContrastVerdict {
  const minOverlap = opts.minOverlap ?? 0.15;
  const { best, bestScore } = bestMatch(findingText, units);

  if (!best || bestScore < minOverlap) return irrelevant(findingRef, bestScore);

  // Injectable judge gets the final say on SIRVE / YA_LO_TENEMOS / MEJOR_QUE_NOSOTROS.
  const judged = opts.judge?.(findingText, best, bestScore);
  if (judged) return { finding_ref: findingRef, verdict: judged.verdict, codebase_unit: best.path, rationale: judged.rationale, confidence: bestScore };

  // Deterministic fallback: strong overlap → we likely already have it; some → it serves.
  return deterministicVerdict(findingRef, best, bestScore);
}

/**
 * F5 — igual que mapFindingToModule pero acepta un juez ASYNC (LLM vía kageLLM).
 * El ranking del candidato sigue siendo determinista; el LLM solo matiza la
 * etiqueta. Si el juez falla o devuelve algo inválido → fallback determinista
 * (fail-closed: un LLM caído nunca deja el contraste sin veredicto).
 */
export async function mapFindingToModuleAsync(findingRef: string, findingText: string, units: CodebaseUnit[], opts: { judge?: AsyncContrastJudge; minOverlap?: number } = {}): Promise<ContrastVerdict> {
  const minOverlap = opts.minOverlap ?? 0.15;
  const { best, bestScore } = bestMatch(findingText, units);

  if (!best || bestScore < minOverlap) return irrelevant(findingRef, bestScore);

  const judged = opts.judge ? await opts.judge(findingText, best, bestScore).catch(() => null) : null;
  if (judged) return { finding_ref: findingRef, verdict: judged.verdict, codebase_unit: best.path, rationale: judged.rationale, confidence: bestScore };

  return deterministicVerdict(findingRef, best, bestScore);
}
