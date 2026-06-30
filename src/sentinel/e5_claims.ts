/**
 * E5 — extractor de claims desde SentinelItems.
 *
 * Flujo:
 *   SentinelItem (rawText + metadatos)
 *     → candidatos de claim (LLM opcional, heurística fallback)
 *     → credibilidad por fuente
 *     → ventana de validez temporal (valid_from / valid_until)
 *     → E5Claim[] listos para memoria temporal E4
 *
 * Tier-1-local: transcripts y páginas navegadas con sesión reciben tier 1,
 * no tier 0, para que puedan ser PLAUSIBLE (no UNFOUNDED automáticamente).
 */

import { createHash } from 'crypto';
import { aggregateCredibility, tierForSource } from '../kagemusha/thread/credibility.js';
import type { SentinelItem } from './types.js';
import type { E5Claim, E5CredLevel, E5Dimension } from './e5_types.js';

/** LLM opcional para extracción estructurada. Recibe el rawText y devuelve JSON. */
export type ClaimLLM = (prompt: string) => Promise<string>;

/** Ventana de validez por tipo de fuente (en días). */
const VALIDITY_DAYS: Record<string, number> = {
  github_repo: 90,      // releases técnicas: vigentes ~3 meses
  rss: 30,              // posts de blog: vigentes ~1 mes
  youtube_channel: 60,  // videos: vigentes ~2 meses
};

/** Dimensiones reconocibles por palabras clave en el texto del claim. */
const DIMENSION_KEYWORDS: [E5Dimension, RegExp][] = [
  ['pass@1',          /\bpass@1\b|\b(success.?rate|task.?success|benchmark.?result|accuracy)\b/i],
  ['pass_k',          /\b(pass\^?k|consistency|reliab\w*|repeat|k.?shot.?success)\b/i],
  ['safety',          /\b(safety|irreversib\w+|permission|gate|approval|deny|block|harm)\b/i],
  ['verificability',  /\b(provenance|verif\w*|audit|sign|chain|tamper|Ed25519|ledger)\b/i],
  ['self_correction', /\bself.?correct\w*|\b(auto.?fix|self.?debug|error.?recover\w*)\b/i],
  ['latency',         /\b(latency|latencia|speed|fast|slow|response.?time|tokens.?per.?sec)\b/i],
  ['cost',            /\b(cost|coste|token.?usage|USD|price|cheap|expensive|budget)\b/i],
  ['accessibility',   /\b(accessibility|usab\w*|non.?techni\w*|family|onboard\w*|wizard|simple)\b/i],
];

export function detectDimension(text: string): E5Dimension | undefined {
  for (const [dim, re] of DIMENSION_KEYWORDS) {
    if (re.test(text)) return dim;
  }
  return undefined;
}

/** Validez temporal del claim en ISO range. */
function validityWindow(item: SentinelItem): { valid_from: string; valid_until: string } {
  const from = item.publishedAt || item.archivedAt;
  const days = VALIDITY_DAYS[item.sourceType] ?? 45;
  const until = new Date(new Date(from).getTime() + days * 86_400_000).toISOString();
  return { valid_from: from, valid_until: until };
}

/** Credibilidad por tipo de fuente del item. */
function credForItem(item: SentinelItem): { level: E5CredLevel; score: number } {
  // Mapeo de sourceType al kind de tierForSource.
  const kindMap: Record<string, Parameters<typeof tierForSource>[0]> = {
    github_repo:      'official_repo',
    rss:              'blog',
    youtube_channel:  'transcript', // Tier-1-local: procesado localmente
  };
  const kind = kindMap[item.sourceType] ?? 'local';
  const tier = tierForSource(kind);
  const verdict = aggregateCredibility({
    source_tier: tier,
    authors_traceable: tier >= 1,
    corroboration_count: 0,
    has_artifacts: item.sourceType === 'github_repo',
    recency_ok: true,
    red_flags: [],
  });
  // Mapeamos CredibilityLevel → E5CredLevel.
  // WEAK (tier-1 sin artefactos) → PLAUSIBLE para E5: fuente real pero sin corroboración.
  // Solo UNFOUNDED (tier-0 o red-flag grave) → excluido del pipeline de hipótesis.
  const level: E5CredLevel =
    verdict.level === 'SOLID' ? 'SOLID'
    : verdict.level === 'UNFOUNDED' ? 'UNFOUNDED'
    : 'PLAUSIBLE';
  return { level, score: verdict.score };
}

function claimId(itemId: string, index: number): string {
  return 'c_' + createHash('sha256').update(`${itemId}:${index}`).digest('hex').slice(0, 12);
}

/** Extracción heurística: parte el rawText en oraciones y elige las más sustanciales. */
function heuristicCandidates(rawText: string, max = 5): string[] {
  return rawText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 300)
    .slice(0, max);
}

/** Extracción con LLM: pide JSON array de {text, quote, dimension?}. */
async function llmCandidates(
  item: SentinelItem,
  llm: ClaimLLM,
  max = 5,
): Promise<Array<{ text: string; quote: string; dimension?: string }>> {
  const prompt = [
    'Extrae los claims más relevantes del siguiente contenido sobre IA y agentes.',
    'Para cada claim devuelve JSON con campos: text (afirmación en 1 frase), quote (cita literal corta), dimension (una de: pass@1, pass_k, safety, verificability, self_correction, latency, cost, accessibility; o null si no aplica).',
    'Devuelve un JSON array con máximo ' + max + ' elementos. Solo JSON, sin explicación.',
    '',
    `Título: ${item.title}`,
    `Fuente: ${item.sourceName} (${item.sourceType})`,
    `Contenido:\n${item.rawText.slice(0, 2000)}`,
  ].join('\n');

  try {
    const raw = await llm(prompt);
    const arr = JSON.parse(raw.replace(/```json\n?|```/g, '').trim());
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, max).filter((x) => typeof x?.text === 'string');
  } catch {
    return [];
  }
}

/**
 * Extrae E5Claims de un SentinelItem.
 * Con LLM: extracción estructurada. Sin LLM: heurística.
 * UNFOUNDED → se devuelve igual (para registro) pero sin dimension.
 */
export async function extractClaims(
  item: SentinelItem,
  opts: { llm?: ClaimLLM; maxClaims?: number } = {},
): Promise<E5Claim[]> {
  const { level, score } = credForItem(item);
  const { valid_from, valid_until } = validityWindow(item);
  const now = new Date().toISOString();

  let candidates: Array<{ text: string; quote: string; dimension?: string }>;

  if (opts.llm) {
    candidates = await llmCandidates(item, opts.llm, opts.maxClaims ?? 5);
  } else {
    candidates = heuristicCandidates(item.rawText, opts.maxClaims ?? 5).map((s) => ({
      text: s,
      quote: s.slice(0, 120),
    }));
  }

  return candidates.map((c, i): E5Claim => {
    const dimFromLLM = c.dimension as E5Dimension | undefined;
    const dimension = level === 'UNFOUNDED'
      ? undefined
      : (dimFromLLM || detectDimension(c.text));
    return {
      claimId: claimId(item.itemId, i),
      text: c.text,
      quote: c.quote || c.text.slice(0, 120),
      sourceUrl: item.url,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      capturedAt: now,
      credibility: level,
      credibilityScore: score,
      dimension,
      valid_from,
      valid_until,
      sourceItemId: item.itemId,
    };
  });
}
