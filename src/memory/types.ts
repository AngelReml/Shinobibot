import type { MemoryProvenance } from '../integrity/provenance.js';

export interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  tags: string[];
  created_at: string;
  last_accessed_at: string;
  access_count: number;
  importance: number;
  embedding?: number[];
  source?: string;
  // FASE C / 11.3 — additive. Where this item came from (origin/channel/seq).
  // Absent = legacy item → treated as UNKNOWN (non-authoritative, fail-closed).
  provenance?: MemoryProvenance;
  // E4 — temporal validity. Absent = no bounds (always active).
  valid_from?: string;   // ISO datetime: entry not active before this
  valid_until?: string;  // ISO datetime: entry expires after this
}

export interface RecallQuery {
  query: string;
  category?: string;
  tags?: string[];
  limit?: number;
  min_score?: number;
}

export interface RecallResult {
  entry: MemoryEntry;
  score: number;
  match_type: 'semantic' | 'keyword' | 'tag';
}

export interface MemoryStoreOptions {
  db_path?: string;
  embedding_dim?: number;
  short_term_window_size?: number;
}
