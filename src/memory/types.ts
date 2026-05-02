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
