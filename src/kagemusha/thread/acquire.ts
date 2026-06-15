/**
 * kagemusha/thread/acquire.ts — C-09: ACQUIRE a node's source (dossier §8, phase ACQUIRE).
 * Fetch arxiv/PDF/repo/web; the network is the live part (Fetcher injected ⚑). The
 * provenance TIER is assigned from the URL (tierForUrl) — a blog is not a peer-reviewed
 * paper. A failed fetch leaves acquired=false (honest: "couldn't get it"), never a
 * fabricated content_ref.
 */

import { tierForUrl } from './resolve.js';
import type { ResearchNode } from '../types.js';

export interface FetchResult { ok: boolean; text: string; finalUrl?: string; error?: string; }
export type Fetcher = (url: string) => Promise<FetchResult>;   // ⚑ live network

export interface AcquireResult { node: ResearchNode; content?: { ref: string; text: string }; }

/** Acquire a node's source. Returns the updated node + (on success) the content to store. */
export async function acquireNode(node: ResearchNode, fetcher: Fetcher, retrievedAt: string): Promise<AcquireResult> {
  if (!node.source_url) {
    return { node: { ...node, acquired: false } };
  }
  let r: FetchResult;
  try { r = await fetcher(node.source_url); }
  catch (e: any) { r = { ok: false, text: '', error: e?.message ?? String(e) }; }
  if (!r.ok || !r.text.trim()) {
    return { node: { ...node, acquired: false } };          // honest: not acquired
  }
  const url = r.finalUrl ?? node.source_url;
  const ref = `content:${node.node_id}`;
  const tier = tierForUrl(url);
  return {
    node: {
      ...node, acquired: true, source_url: url, content_ref: ref,
      provenance: { ...node.provenance, source_url: url, trust_tier: tier, retrieved_at: retrievedAt },
    },
    content: { ref, text: r.text },
  };
}
