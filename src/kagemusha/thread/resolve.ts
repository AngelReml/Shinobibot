/**
 * kagemusha/thread/resolve.ts — RESOLVE: find the source (dossier §8.2).
 *
 * The exact cascade Iván described, as an ordered pipeline that STOPS at the first
 * hit: transcript link → video description → pinned/first comment → web search.
 * No hit → acquired:false, recorded as an honest gap. Nothing is invented.
 *
 * The reference EXTRACTION (regex over text) is pure and tested here. The live
 * steps (description/comment via CDP, web search via ToolSearch) are injected as
 * async resolvers so the cascade is testable without network.
 */

import type { Entity, Transcript, TrustTier } from '../types.js';

export interface ResolvedRef { url?: string; tier: TrustTier; via: string; }

const URL_RE = /\bhttps?:\/\/[^\s<>")]+/gi;
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
const ARXIV_RE = /\barxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?\b/gi;

/** Extract candidate references (urls, DOIs, arxiv ids) from free text. Pure. */
export function extractReferences(text: string): { urls: string[]; dois: string[]; arxiv: string[] } {
  const urls = uniq((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,);]+$/, '')));
  const dois = uniq((text.match(DOI_RE) ?? []).map((d) => d.replace(/[.,);]+$/, '')));
  const arxiv: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(ARXIV_RE);
  while ((m = re.exec(text))) arxiv.push(m[1]);
  return { urls, dois, arxiv: uniq(arxiv) };
}

function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }

/** Tier a URL by its host (arxiv/openreview/acl/official repo = 2, blog = 1). */
export function tierForUrl(url: string): TrustTier {
  if (/arxiv\.org|openreview\.net|aclanthology\.org|doi\.org|\.edu\b|github\.com|gitlab\.com|huggingface\.co/i.test(url)) return 2;
  if (/medium\.com|substack\.com|wordpress|blogspot|dev\.to|news\.ycombinator/i.test(url)) return 1;
  if (/reddit\.com|forum|comments?/i.test(url)) return 0;
  return 1;
}

export interface ResolveDeps {
  /** Fetch the video description text for a transcript's video. */
  getDescription?: (videoId: string) => Promise<string | null>;
  /** Fetch the top/pinned comment text for a video. */
  getTopComment?: (videoId: string) => Promise<string | null>;
  /** Web-search for a named reference; return the best high-tier URL. */
  webSearch?: (query: string) => Promise<{ url: string; tier: TrustTier } | null>;
}

/**
 * Run the RESOLVE cascade for a seed entity, stopping at the first hit. Records
 * the `via` so the hard test can assert resolution did NOT come from a transcript
 * link (the needle-without-link case).
 */
export async function resolveReference(seed: Entity, ctx: { transcript: Transcript }, deps: ResolveDeps): Promise<ResolvedRef | null> {
  // 1) Link in the transcript itself.
  const inText = extractReferences(ctx.transcript.text);
  const firstUrl = inText.urls[0] || (inText.arxiv[0] ? `https://arxiv.org/abs/${inText.arxiv[0]}` : '') || (inText.dois[0] ? `https://doi.org/${inText.dois[0]}` : '');
  if (firstUrl && relevant(firstUrl, seed)) return { url: firstUrl, tier: tierForUrl(firstUrl), via: 'transcript_link' };

  // 2) Link in the video description.
  if (deps.getDescription) {
    const desc = await deps.getDescription(ctx.transcript.video_id);
    if (desc) {
      const refs = extractReferences(desc);
      const u = refs.urls[0] || (refs.arxiv[0] ? `https://arxiv.org/abs/${refs.arxiv[0]}` : '');
      if (u) return { url: u, tier: tierForUrl(u), via: 'description' };
    }
  }

  // 3) Pinned / first comment (authors often drop refs there).
  if (deps.getTopComment) {
    const c = await deps.getTopComment(ctx.transcript.video_id);
    if (c) {
      const refs = extractReferences(c);
      const u = refs.urls[0] || (refs.arxiv[0] ? `https://arxiv.org/abs/${refs.arxiv[0]}` : '');
      if (u) return { url: u, tier: tierForUrl(u), via: 'comment' };
    }
  }

  // 4) Web search by name + qualifiers, filtered to high-tier sources.
  if (deps.webSearch) {
    const q = `${seed.name} ${seed.kind === 'paper' ? 'paper arxiv' : ''}`.trim();
    const hit = await deps.webSearch(q);
    if (hit) return { url: hit.url, tier: hit.tier, via: 'web_search' };
  }

  // 5) No hit → honest gap.
  return null;
}

function relevant(url: string, seed: Entity): boolean {
  const name = seed.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const u = url.toLowerCase();
  return name.length === 0 || name.some((w) => u.includes(w)) || /arxiv|doi/.test(u);
}
