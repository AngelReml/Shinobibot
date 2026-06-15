/**
 * shitsuji/understand.ts — T-04: COMPRENDER, lenguaje natural → Intent (dossier §7).
 * Real orders are ambiguous ("mi foto", "mi programa de diseño", "la carpeta de
 * siempre"); the butler resolves the references and disambiguates BEFORE planning,
 * because touching the wrong real file is real damage (⚑ R5).
 *
 * Split, as everywhere in the dojo, into a LIVE seam and a DETERMINISTIC core:
 *   - LIVE (⚑): the strong model decomposing the utterance into atomic goals +
 *     referential phrases (IntentParser). Injected — not in this file.
 *   - DETERMINISTIC (here, tested): the reference-resolution CASCADE (Atlas →
 *     filesystem → context → ask) with method+confidence per resolution, and the
 *     DISAMBIGUATION GATE: if a reference has several plausible options or low
 *     confidence, the intent is NOT ready — the butler asks ONE concrete question
 *     rather than guessing on real data. High confidence ⇒ proceed, no nagging.
 */

import type { Atlas } from '../chizu/atlas/atlas.js';
import type { AppCategory } from '../chizu/types.js';
import type { Intent, Goal, ResolvedReference, Ambiguity } from './types.js';

const HIGH_CONF = 0.9;          // a clearly dominant resolution
const AMBIGUITY_MARGIN = 0.15;  // top-1 must beat top-2 by this much to be unambiguous

/** A referential phrase the LLM extracted, with a structured hint for resolution. */
export interface RefPhrase {
  phrase: string;                              // "mi programa de diseño"
  kind: 'app' | 'file' | 'folder' | 'context';
  category?: AppCategory;                      // for kind 'app' (e.g. 'design')
  query?: string;                              // for 'file'/'folder' filesystem search
}

/** What the strong model produces from the raw utterance (the LIVE seam output). */
export interface NLParse {
  goals: { verb: string; object: string; constraints?: string[] }[];
  references: RefPhrase[];
}

/** ⚑ LIVE: decompose an utterance into goals + referential phrases (the LLM). */
export type IntentParser = (utterance: string) => Promise<NLParse>;

export interface FileCandidate { path: string; }

/** Injectable resolvers for the cascade. atlas = Chizu; the rest reach real disk/context (⚑). */
export interface ReferenceResolvers {
  atlas?: Atlas;
  searchFiles?: (query: string) => FileCandidate[];        // ⚑ filesystem
  fromContext?: (phrase: string) => string | null;         // recent context / memory
}

interface Resolution { ref: ResolvedReference; ambiguity?: Ambiguity; }

/** Resolve one referential phrase through the cascade. Pure given the resolvers. */
function resolveOne(p: RefPhrase, r: ReferenceResolvers): Resolution {
  if (p.kind === 'app') return resolveApp(p, r);
  if (p.kind === 'file' || p.kind === 'folder') return resolveFile(p, r);
  return resolveContext(p, r);
}

function resolveApp(p: RefPhrase, r: ReferenceResolvers): Resolution {
  if (!r.atlas || !p.category) return unresolved(p, 'atlas');
  // Chizu excludes the forbidden — never auto-resolve a real order to a forbidden app.
  const apps = r.atlas.query({ category: p.category })
    .filter((c) => c.risk.level !== 'forbidden')
    .sort((a, b) => b.usage.usage_score - a.usage.usage_score);
  if (apps.length === 0) return unresolved(p, 'atlas');
  if (apps.length === 1) return resolved(p, apps[0].app_id, 'atlas', 0.95);
  const [t1, t2] = apps;
  if (t1.usage.usage_score - t2.usage.usage_score >= AMBIGUITY_MARGIN) {
    return resolved(p, t1.app_id, 'atlas', HIGH_CONF);   // clear winner
  }
  // Several equally-plausible apps → ask, don't guess (⚑).
  const options = apps.filter((c) => t1.usage.usage_score - c.usage.usage_score < AMBIGUITY_MARGIN).map((c) => c.app_id);
  return ambiguous(p, 'atlas', options);
}

function resolveFile(p: RefPhrase, r: ReferenceResolvers): Resolution {
  if (!r.searchFiles) return unresolved(p, 'filesystem');
  const hits = r.searchFiles(p.query ?? p.phrase);
  if (hits.length === 0) return unresolved(p, 'filesystem');
  if (hits.length === 1) return resolved(p, hits[0].path, 'filesystem', HIGH_CONF);
  return ambiguous(p, 'filesystem', hits.map((h) => h.path));   // which file? ask (⚑)
}

function resolveContext(p: RefPhrase, r: ReferenceResolvers): Resolution {
  const hit = r.fromContext?.(p.phrase) ?? null;
  return hit ? resolved(p, hit, 'context', 0.8) : unresolved(p, 'context');
}

const resolved = (p: RefPhrase, to: string, method: ResolvedReference['method'], confidence: number): Resolution =>
  ({ ref: { phrase: p.phrase, resolved_to: to, method, confidence } });
const unresolved = (p: RefPhrase, method: ResolvedReference['method']): Resolution =>
  ({ ref: { phrase: p.phrase, resolved_to: '', method, confidence: 0 } });
const ambiguous = (p: RefPhrase, method: ResolvedReference['method'], options: string[]): Resolution =>
  ({ ref: { phrase: p.phrase, resolved_to: '', method, confidence: 0.5 }, ambiguity: { phrase: p.phrase, options, resolution: '', asked: false } });

/** Build an Intent from the LLM parse + the resolvers (the deterministic core). */
export function understand(intentId: string, utterance: string, parse: NLParse, resolvers: ReferenceResolvers = {}): Intent {
  const goals: Goal[] = parse.goals.map((g, i) => ({ goal_id: `g${i + 1}`, verb: g.verb, object: g.object, constraints: g.constraints ?? [] }));
  const references: ResolvedReference[] = [];
  const ambiguities: Ambiguity[] = [];
  for (const p of parse.references) {
    const res = resolveOne(p, resolvers);
    references.push(res.ref);
    if (res.ambiguity) ambiguities.push(res.ambiguity);
  }
  return { intent_id: intentId, raw_utterance: utterance, goals, references, ambiguities };
}

/** ⚑ LIVE + core: run the LLM parser, then resolve/disambiguate deterministically. */
export async function comprehend(intentId: string, utterance: string, parse: IntentParser, resolvers: ReferenceResolvers = {}): Promise<Intent> {
  return understand(intentId, utterance, await parse(utterance), resolvers);
}

/** Is the intent ready to plan? Every reference resolved AND no open ambiguity. */
export function intentReady(intent: Intent): boolean {
  return intent.ambiguities.every((a) => a.asked) && intent.references.every((r) => r.resolved_to !== '');
}

/** The concrete questions to ask the user (⚑: one per real-data ambiguity / gap). */
export function pendingQuestions(intent: Intent): string[] {
  const qs: string[] = [];
  for (const a of intent.ambiguities) if (!a.asked) qs.push(`¿A cuál te refieres con "${a.phrase}"? Opciones: ${a.options.join(' / ')}`);
  for (const r of intent.references) {
    if (r.resolved_to === '' && !intent.ambiguities.some((a) => a.phrase === r.phrase)) {
      qs.push(`No encontré a qué te refieres con "${r.phrase}". ¿Me lo concretas?`);
    }
  }
  return qs;
}

/** Apply the user's answer to a pending reference: resolves it with method 'asked_user'. */
export function applyAnswer(intent: Intent, phrase: string, chosen: string): Intent {
  const amb = intent.ambiguities.find((a) => a.phrase === phrase);
  if (amb) { amb.resolution = chosen; amb.asked = true; }
  const ref = intent.references.find((r) => r.phrase === phrase);
  if (ref) { ref.resolved_to = chosen; ref.method = 'asked_user'; ref.confidence = 1; }
  return intent;
}
