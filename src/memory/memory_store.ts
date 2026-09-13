import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { MemoryEntry, RecallQuery, RecallResult, MemoryStoreOptions } from './types.js';
import { EmbeddingProvider } from './embedding_provider.js';
import type { MemoryProvenance } from '../integrity/provenance.js';
import { shinobiDataDir } from '../runtime/data_dir.js';

export class MemoryStore {
  private db: BetterSqlite3.Database;
  private dbPath: string;
  private shortTermWindow: number;

  constructor(options: MemoryStoreOptions = {}) {
    const defaultDir = shinobiDataDir();

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
        source TEXT,
        provenance TEXT,
        valid_from TEXT,
        valid_until TEXT
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
    // Additive migrations — idempotent for legacy DBs.
    const cols = this.db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'provenance')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN provenance TEXT`);
    }
    if (!cols.some((c) => c.name === 'valid_from')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN valid_from TEXT`);
    }
    if (!cols.some((c) => c.name === 'valid_until')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN valid_until TEXT`);
    }
  }

  public async store(content: string, options: {
    category?: string;
    tags?: string[];
    importance?: number;
    source?: string;
    provenance?: MemoryProvenance;
    valid_from?: string;
    valid_until?: string;
  } = {}): Promise<MemoryEntry> {
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
      source: options.source,
      provenance: options.provenance,
      valid_from: options.valid_from,
      valid_until: options.valid_until,
    };

    this.db.prepare(`
      INSERT INTO memories (id, content, category, tags, created_at, last_accessed_at, access_count, importance, embedding, source, provenance, valid_from, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.content, entry.category, JSON.stringify(entry.tags),
      entry.created_at, entry.last_accessed_at, entry.access_count, entry.importance,
      JSON.stringify(entry.embedding), entry.source || null,
      entry.provenance ? JSON.stringify(entry.provenance) : null,
      entry.valid_from ?? null,
      entry.valid_until ?? null,
    );

    return entry;
  }

  public async recall(query: RecallQuery): Promise<RecallResult[]> {
    const queryEmbedding = await EmbeddingProvider.embed(query.query);
    const limit = query.limit || 10;
    const minScore = query.min_score ?? 0.0;
    const lowerQuery = query.query.toLowerCase();

    let sql = 'SELECT * FROM memories';
    const conditions: string[] = [];
    const params: any[] = [];
    if (query.category) { conditions.push('category = ?'); params.push(query.category); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

    const rows = this.db.prepare(sql).all(...params) as any[];
    const results: RecallResult[] = [];
    const now = new Date();

    for (const row of rows) {
      // E4 — self-check gate: silently drop expired or not-yet-active entries.
      if (row.valid_until && new Date(row.valid_until) < now) continue;
      if (row.valid_from && new Date(row.valid_from) > now) continue;

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
        source: row.source,
        provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
        valid_from: row.valid_from ?? undefined,
        valid_until: row.valid_until ?? undefined,
      };

      let score = 0;
      let matched = false;
      let matchType: 'semantic' | 'keyword' | 'tag' = 'keyword';
      // Solo usamos el vector si tiene la misma dim que el query — un
      // cambio de provider (local 384 → openai 1536) invalida los
      // embeddings viejos pero el recall debe seguir respondiendo via
      // keyword match hasta que se haga re-embed manual.
      if (entry.embedding && entry.embedding.length === queryEmbedding.length) {
        // Normaliza el coseno [-1,1] a [0,1]. Antes el score crudo (que
        // puede ser negativo para vectores anti-correlados) se mezclaba
        // con el score fijo de keyword (0.5): un coseno negativo restaba
        // del score combinado y el ranking semántico vs keyword era
        // arbitrario. Ahora ambos viven en la misma escala [0,1].
        const cos = EmbeddingProvider.cosineSimilarity(queryEmbedding, entry.embedding);
        score = (cos + 1) / 2;
        matchType = 'semantic';
        matched = true;
      } else if (entry.content.toLowerCase().includes(lowerQuery)) {
        score = 0.5;
        matchType = 'keyword';
        matched = true;
      }

      if (query.tags && entry.tags.some(t => query.tags!.includes(t))) {
        score += 0.1;
        matchType = 'tag';
        matched = true;
      }

      // Una memoria que NO matcheó por nada (sin embedding compatible, sin
      // keyword, sin tag) NO entra al ranking. Antes la fórmula combinada
      // le daba `importance*0.2 + access*0.1` > 0 y, con min_score bajo,
      // recall devolvía memorias irrelevantes que no matcheaban la query.
      if (!matched) continue;

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
    // BAJA-04 (auditoría 2026-07-01): `recall_log` crecía sin purga
    // programada — una fila por cada resultado de cada búsqueda, degradando
    // I/O en el WAL bajo uso intensivo. Purga probabilística (1%) en vez de
    // en cada inserción, para no añadir overhead constante: mantiene la
    // tabla acotada a las últimas ~5000 filas sin un scheduler separado.
    if (Math.random() < 0.01) this.pruneRecallLog();
  }

  /** Mantiene `recall_log` acotado a las últimas `keep` filas (BAJA-04). Público para tests deterministas (la purga real es probabilística, ver recordRecall). */
  public pruneRecallLog(keep: number = 5000): void {
    this.db.prepare(
      `DELETE FROM recall_log WHERE id NOT IN (SELECT id FROM recall_log ORDER BY id DESC LIMIT ?)`,
    ).run(keep);
  }

  public forget(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Reconstruye el índice semántico DESDE la memoria en Markdown.
   *
   * Tras la migración a memory/MEMORY.md, este SQLite ya NO es la fuente de
   * verdad de la memoria de usuario/entorno — es un índice de recall por
   * embeddings, derivado y desechable. `reindexFromMarkdown` lo vacía y lo
   * re-puebla con las entradas del .md. Idempotente: dos llamadas seguidas
   * dejan el mismo estado.
   *
   * Lo invoca semantic_index.ts en el arranque (ver loadAtBoot wiring).
   */
  public async reindexFromMarkdown(entries: string[]): Promise<number> {
    this.db.prepare('DELETE FROM memories').run();
    this.db.prepare('DELETE FROM recall_log').run();
    let indexed = 0;
    for (const raw of entries) {
      const text = (raw || '').trim();
      if (!text) continue;
      // Curated MEMORY.md is the trusted, signed-by-the-operator vault → SYSTEM
      // origin (policy-authoritative). Channel + seq 0 (present at boot).
      await this.store(text, { category: 'curated', source: 'memory/MEMORY.md', provenance: { origin: 'SYSTEM', channel: 'curated_markdown', session_seq: 0 } });
      indexed++;
    }
    return indexed;
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

  /** Nº total de filas en recall_log — usado por tests de la purga BAJA-04. */
  public recallLogCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM recall_log').get() as any).c;
  }

  public stats(): { total: number; recent_recalls: number; categories: string[] } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    const recent = (this.db.prepare(`SELECT COUNT(*) as c FROM recall_log WHERE timestamp > datetime('now', '-1 day')`).get() as any).c;
    const cats = (this.db.prepare('SELECT DISTINCT category FROM memories').all() as any[]).map(r => r.category);
    return { total, recent_recalls: recent, categories: cats };
  }

  public close(): void { this.db.close(); }
}

// ─── Singleton compartido ──────────────────────────────────────────────────
//
// Un único MemoryStore por proceso: el orchestrator (buildContextSection) y
// semantic_index.ts (reindex en boot) deben operar sobre la MISMA instancia
// SQLite — abrir dos `better-sqlite3` sobre memory.db competiría por el WAL.

let _sharedStore: MemoryStore | null = null;
let _sharedStoreWarned = false;

export function sharedMemoryStore(): MemoryStore {
  // ALTA-21 (auditoría 2026-07-01): en modo multi-usuario (mismo flag que
  // habilita resolveUser() a asignar userIds no-owner — SHINOBI_TRUST_USER_HEADER),
  // cualquier caller legacy que use el store COMPARTIDO en vez de
  // `getMemoryStore(userId)` mezcla el índice de recall del owner con el de
  // otros usuarios. No hay forma de bloquear el uso indebido sin romper
  // callers single-user legítimos, así que se avisa (una vez por proceso)
  // para que sea diagnosticable.
  if (process.env.SHINOBI_TRUST_USER_HEADER === '1' && !_sharedStoreWarned) {
    _sharedStoreWarned = true;
    console.warn(
      '[memory_store] sharedMemoryStore() usado con SHINOBI_TRUST_USER_HEADER=1 (modo multi-usuario) — ' +
      'este caller debería migrar a getMemoryStore(userId) para no mezclar el índice de recall entre usuarios.',
    );
  }
  if (!_sharedStore) _sharedStore = new MemoryStore();
  return _sharedStore;
}

// ─── Instancias aisladas por userId (FIX 1.1) ─────────────────────────────
//
// En modo multi-usuario, cada userId obtiene su propio MemoryStore respaldado
// por un SQLite independiente (<Shinobi>/users/<userId>/memory.db). De esta
// forma el recall de un usuario nunca contamina el de otro.
// Los callers en modo multi-usuario deben usar `getMemoryStore(userId)` en
// lugar de `sharedMemoryStore()`.

const _userStores = new Map<string, MemoryStore>();

export function getMemoryStore(userId: string): MemoryStore {
  if (!_userStores.has(userId)) {
    const defaultDir = shinobiDataDir();
    const userDir = path.join(defaultDir, 'users', userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    _userStores.set(userId, new MemoryStore({ db_path: path.join(userDir, 'memory.db') }));
  }
  return _userStores.get(userId)!;
}
