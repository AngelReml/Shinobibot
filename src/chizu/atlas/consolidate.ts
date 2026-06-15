/**
 * chizu/atlas/consolidate.ts — M-13: consolidate discovery batches into a single
 * versioned Atlas and persist it. Reuses fuse() (dedup by canonical identity, M-06)
 * and the ChizuStore (versioned-by-scan, M-02). Pure wiring: no new dedup or schema.
 */

import { fuse, type SourceBatch } from '../discovery/fuse.js';
import { Atlas } from './atlas.js';
import type { ChizuStore } from '../store.js';
import type { AppCard } from '../types.js';

/** Consolidate batches → deduped AppCards (canonical identity), build the Atlas. */
export function consolidateAtlas(batches: SourceBatch[], retrievedAt: string): { cards: AppCard[]; atlas: Atlas } {
  const cards = fuse(batches, { retrievedAt });
  return { cards, atlas: new Atlas(cards) };
}

/** Consolidate + persist as a new scan; returns the live Atlas for that scan. */
export function consolidateAndPersist(batches: SourceBatch[], store: ChizuStore, scanId: string, ts: string): Atlas {
  const { cards, atlas } = consolidateAtlas(batches, ts);
  store.saveScan(scanId, cards, ts);
  return atlas;
}
