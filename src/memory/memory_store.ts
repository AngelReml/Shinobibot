import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { MemoryEntry, RecallQuery, RecallResult, MemoryStoreOptions } from './types.js';
import { EmbeddingProvider } from './embedding_provider.js';

export class MemoryStore {
  private db: Database.Database;
  private dbPath: string;
  private shortTermWindow: number;

  constructor(options: MemoryStoreOptions = {}) {
    const defaultDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });

    this.dbPath = options.db_path || path.join(defaultDir, 'memory.db');
    this.shortTermWindow = options.short_term_window_size || 20;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        importance REAL NOT NULL DEFAULT 0.5,
        embedding TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

      CREATE TABLE IF NOT EXISTS recall_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        query TEXT,
        score REAL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recall_memory ON recall_log(memory_id);
      CREATE INDEX IF NOT EXISTS idx_recall_timestamp ON recall_log(timestamp DESC);
    `);
  }

  public async store(content: string, options: { category?: string; tags?: string[]; importance?: number; source?: string } = {}): Promise<MemoryEntry> {
    const id = crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const embedding = await EmbeddingProvider.embed(content);
    const entry: MemoryEntry = {
      id,
      content,
      category: options.category || 'general',
      tags: options.tags || [],
      created_at: now,
      last_accessed_at: now,
      access_count: 0,
      importance: options.importance ?? 0.5,
      embedding,
      source: options.source
    };

    this.db.prepare(`
      INSERT INTO memories (id, content, category, tags, created_at, last_accessed_at, access_count, importance, embedding, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.content, entry.category, JSON.stringify(entry.tags),
      entry.created_at, entry.last_accessed_at, entry.access_count, entry.importance,
      JSON.stringify(entry.embedding), entry.source || null
    );

    return entry;
  }

  public async recall(query: RecallQuery): Promise<RecallResult[]> {
    const queryEmbedding = await EmbeddingProvider.embed(query.query);
    const limit = query.limit || 10;
    const minScore = query.min_score ?? 0.0;

    let sql = 'SELECT * FROM memories';
    const conditions: string[] = [];
    const params: any[] = [];
    if (query.category) { conditions.push('category = ?'); params.push(query.category); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

    const rows = this.db.prepare(sql).all(...params) as any[];
    const results: RecallResult[] = [];

    for (const row of rows) {
      const entry: MemoryEntry = {
        id: row.id,
        content: row.content,
        category: row.category,
        tags: JSON.parse(row.tags),
        created_at: row.created_at,
        last_accessed_at: row.last_accessed_at,
        access_count: row.access_count,
        importance: row.importance,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
        source: row.source
      };

      let score = 0;
      let matchType: 'semantic' | 'keyword' | 'tag' = 'keyword';
      if (entry.embedding) {
        score = EmbeddingProvider.cosineSimilarity(queryEmbedding, entry.embedding);
        matchType = 'semantic';
      } else if (entry.content.toLowerCase().includes(query.query.toLowerCase())) {
        score = 0.5;
        matchType = 'keyword';
      }

      if (query.tags && entry.tags.some(t => query.tags!.includes(t))) {
        score += 0.1;
        matchType = 'tag';
      }

      score = score * 0.7 + entry.importance * 0.2 + Math.min(entry.access_count / 100, 1) * 0.1;

      if (score >= minScore) results.push({ entry, score, match_type: matchType });
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);
    this.recordRecall(top, query.query);
    return top;
  }

  private recordRecall(results: RecallResult[], queryText: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`INSERT INTO recall_log (memory_id, query, score, timestamp) VALUES (?, ?, ?, ?)`);
    const updateStmt = this.db.prepare(`UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`);
    for (const r of results) {
      stmt.run(r.entry.id, queryText, r.score, now);
      updateStmt.run(now, r.entry.id);
    }
  }

  public forget(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  public getRecentMemories(limit: number = 10): MemoryEntry[] {
    const rows = this.db.prepare(`SELECT * FROM memories ORDER BY last_accessed_at DESC LIMIT ?`).all(limit) as any[];
    return rows.map(r => ({
      id: r.id, content: r.content, category: r.category,
      tags: JSON.parse(r.tags), created_at: r.created_at,
      last_accessed_at: r.last_accessed_at, access_count: r.access_count,
      importance: r.importance, source: r.source
    }));
  }

  public async buildContextSection(query: string, maxChars: number = 2000): Promise<string> {
    const results = await this.recall({ query, limit: 5, min_score: 0.3 });
    if (results.length === 0) return '';
    // Memory citations mode (Tier A #8): cada memoria recordada incluye su
    // id, score, categoría y match type. El usuario puede inspeccionar o
    // borrar la memoria directamente; el LLM sabe exactamente de dónde
    // viene cada dato que cita.
    const { contextSection } = await import('./memory_citations.js');
    return contextSection(results, maxChars);
  }

  public stats(): { total: number; recent_recalls: number; categories: string[] } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    const recent = (this.db.prepare(`SELECT COUNT(*) as c FROM recall_log WHERE timestamp > datetime('now', '-1 day')`).get() as any).c;
    const cats = (this.db.prepare('SELECT DISTINCT category FROM memories').all() as any[]).map(r => r.category);
    return { total, recent_recalls: recent, categories: cats };
  }

  public close(): void { this.db.close(); }
}
