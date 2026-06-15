/**
 * kagemusha/store/store.ts — persistence for the night mission (dossier §5).
 *
 * Pattern follows src/memory/memory_store.ts (better-sqlite3 via createRequire,
 * WAL, idempotent CREATE IF NOT EXISTS + ALTER guard). The dossier asks to "extend
 * the existing store"; in practice MemoryStore.db is private and sharing one
 * better-sqlite3 connection risks WAL write-locks, so Kagemusha owns a SIBLING DB
 * (kagemusha.db) in the same dir, with the SAME migration discipline. The repo's
 * real shape wins over the dossier's letter (§0).
 *
 * All rows carry Provenance (assigned at the entry point, never inferred later).
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {
  Channel, Transcript, Entity, ResearchNode, ResearchEdge, Claim,
  CodebaseUnit, ContrastVerdict, DawnReport, MissionState, AnalysisFinding,
} from '../types.js';

export interface KagemushaStoreOptions { db_path?: string; }

interface Chunk {
  chunk_id: string; transcript_id: string; idx: number;
  text: string; embedding?: number[]; char_start: number; char_end: number;
}

export class KagemushaStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: KagemushaStoreOptions = {}) {
    const defaultDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    this.dbPath = options.db_path || path.join(defaultDir, 'kagemusha.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_channels (
        channel_id TEXT PRIMARY KEY, title TEXT NOT NULL, watch_rank INTEGER );

      CREATE TABLE IF NOT EXISTS kg_transcripts (
        transcript_id TEXT PRIMARY KEY, video_id TEXT, channel_id TEXT, title TEXT,
        lang TEXT, published_at TEXT, text TEXT NOT NULL, token_count INTEGER,
        provenance TEXT, ingested_at TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_tx_channel ON kg_transcripts(channel_id);

      CREATE TABLE IF NOT EXISTS kg_chunks (
        chunk_id TEXT PRIMARY KEY, transcript_id TEXT, idx INTEGER, text TEXT,
        embedding TEXT, char_start INTEGER, char_end INTEGER );
      CREATE INDEX IF NOT EXISTS idx_kg_chunk_tx ON kg_chunks(transcript_id);

      CREATE TABLE IF NOT EXISTS kg_findings (
        finding_id TEXT PRIMARY KEY, angle TEXT, summary TEXT,
        evidence_transcript_ids TEXT, provenance TEXT );

      CREATE TABLE IF NOT EXISTS kg_entities (
        entity_id TEXT PRIMARY KEY, kind TEXT, name TEXT, raw_mentions TEXT,
        first_seen_at TEXT, relevance_score REAL, provenance TEXT );

      CREATE TABLE IF NOT EXISTS kg_nodes (
        node_id TEXT PRIMARY KEY, entity_id TEXT, kind TEXT, label TEXT,
        acquired INTEGER, source_url TEXT, content_ref TEXT, credibility TEXT,
        depth INTEGER, provenance TEXT );

      CREATE TABLE IF NOT EXISTS kg_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, from_node TEXT, to_node TEXT, relation TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_edge_from ON kg_edges(from_node);

      CREATE TABLE IF NOT EXISTS kg_claims (
        claim_id TEXT PRIMARY KEY, text TEXT, node_id TEXT, status TEXT,
        corroborating_sources TEXT, credibility TEXT, provenance TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_claim_node ON kg_claims(node_id);

      CREATE TABLE IF NOT EXISTS kg_content (
        content_ref TEXT PRIMARY KEY, text TEXT, retrieved_at TEXT );

      CREATE TABLE IF NOT EXISTS kg_codebase_units (
        unit_id TEXT PRIMARY KEY, path TEXT, symbol TEXT, capability_summary TEXT,
        embedding TEXT, file_hash TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_unit_path ON kg_codebase_units(path);

      CREATE TABLE IF NOT EXISTS kg_contrast (
        id INTEGER PRIMARY KEY AUTOINCREMENT, finding_ref TEXT, verdict TEXT,
        codebase_unit TEXT, rationale TEXT, confidence REAL );

      CREATE TABLE IF NOT EXISTS kg_reports (
        report_id TEXT PRIMARY KEY, mission_id TEXT, generated_at TEXT, json TEXT );

      CREATE TABLE IF NOT EXISTS kg_mission_state (
        mission_id TEXT PRIMARY KEY, phase TEXT, json TEXT, updated_at TEXT );
    `);
    // Idempotent ALTER guard pattern (for future additive columns on legacy DBs).
    this.ensureColumn('kg_transcripts', 'token_count', 'INTEGER');
  }

  private ensureColumn(table: string, col: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }

  // ── Channels ──────────────────────────────────────────────────────────────
  upsertChannel(c: Channel): void {
    this.db.prepare(`INSERT INTO kg_channels (channel_id, title, watch_rank) VALUES (?,?,?)
      ON CONFLICT(channel_id) DO UPDATE SET title=excluded.title, watch_rank=excluded.watch_rank`)
      .run(c.channel_id, c.title, c.watch_rank ?? null);
  }

  // ── Transcripts (dedup by transcript_id; re-import is idempotent) ──────────
  upsertTranscript(t: Transcript): boolean {
    const exists = this.db.prepare(`SELECT 1 FROM kg_transcripts WHERE transcript_id=?`).get(t.transcript_id);
    this.db.prepare(`INSERT INTO kg_transcripts
      (transcript_id, video_id, channel_id, title, lang, published_at, text, token_count, provenance, ingested_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(transcript_id) DO UPDATE SET text=excluded.text, token_count=excluded.token_count`)
      .run(t.transcript_id, t.video_id, t.channel_id, t.title, t.lang, t.published_at ?? null,
        t.text, t.token_count, JSON.stringify(t.provenance), t.ingested_at);
    return !exists;   // true = newly inserted
  }
  listTranscripts(channelId?: string): Transcript[] {
    const rows = (channelId
      ? this.db.prepare(`SELECT * FROM kg_transcripts WHERE channel_id=? ORDER BY published_at`).all(channelId)
      : this.db.prepare(`SELECT * FROM kg_transcripts ORDER BY published_at`).all()) as any[];
    return rows.map(rowToTranscript);
  }
  countTranscripts(): number {
    return (this.db.prepare(`SELECT COUNT(*) c FROM kg_transcripts`).get() as any).c;
  }

  // ── Chunks ────────────────────────────────────────────────────────────────
  insertChunk(ch: Chunk): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_chunks (chunk_id, transcript_id, idx, text, embedding, char_start, char_end)
      VALUES (?,?,?,?,?,?,?)`).run(ch.chunk_id, ch.transcript_id, ch.idx, ch.text,
        ch.embedding ? JSON.stringify(ch.embedding) : null, ch.char_start, ch.char_end);
  }
  allChunks(): Chunk[] {
    return (this.db.prepare(`SELECT * FROM kg_chunks`).all() as any[]).map((r) => ({
      chunk_id: r.chunk_id, transcript_id: r.transcript_id, idx: r.idx, text: r.text,
      embedding: r.embedding ? JSON.parse(r.embedding) : undefined, char_start: r.char_start, char_end: r.char_end,
    }));
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  upsertEntity(e: Entity): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_entities
      (entity_id, kind, name, raw_mentions, first_seen_at, relevance_score, provenance) VALUES (?,?,?,?,?,?,?)`)
      .run(e.entity_id, e.kind, e.name, JSON.stringify(e.raw_mentions), e.first_seen_at, e.relevance_score, JSON.stringify(e.provenance));
  }
  listEntities(): Entity[] {
    return (this.db.prepare(`SELECT * FROM kg_entities ORDER BY relevance_score DESC`).all() as any[]).map((r) => ({
      entity_id: r.entity_id, kind: r.kind, name: r.name, raw_mentions: JSON.parse(r.raw_mentions || '[]'),
      first_seen_at: r.first_seen_at, relevance_score: r.relevance_score, provenance: JSON.parse(r.provenance),
    }));
  }

  // ── Findings ──────────────────────────────────────────────────────────────
  upsertFinding(f: AnalysisFinding): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_findings (finding_id, angle, summary, evidence_transcript_ids, provenance)
      VALUES (?,?,?,?,?)`).run(f.finding_id, f.angle, f.summary, JSON.stringify(f.evidence_transcript_ids), JSON.stringify(f.provenance));
  }

  // ── Graph: nodes / edges / claims ─────────────────────────────────────────
  upsertNode(n: ResearchNode): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_nodes
      (node_id, entity_id, kind, label, acquired, source_url, content_ref, credibility, depth, provenance)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(n.node_id, n.entity_id ?? null, n.kind, n.label,
        n.acquired ? 1 : 0, n.source_url ?? null, n.content_ref ?? null,
        n.credibility ? JSON.stringify(n.credibility) : null, n.depth, JSON.stringify(n.provenance));
  }
  listNodes(): ResearchNode[] {
    return (this.db.prepare(`SELECT * FROM kg_nodes`).all() as any[]).map((r) => ({
      node_id: r.node_id, entity_id: r.entity_id ?? undefined, kind: r.kind, label: r.label,
      acquired: !!r.acquired, source_url: r.source_url ?? undefined, content_ref: r.content_ref ?? undefined,
      credibility: r.credibility ? JSON.parse(r.credibility) : undefined, depth: r.depth, provenance: JSON.parse(r.provenance),
    }));
  }
  addEdge(e: ResearchEdge): void {
    this.db.prepare(`INSERT INTO kg_edges (from_node, to_node, relation) VALUES (?,?,?)`).run(e.from, e.to, e.relation);
  }
  listEdges(): ResearchEdge[] {
    return (this.db.prepare(`SELECT from_node, to_node, relation FROM kg_edges`).all() as any[])
      .map((r) => ({ from: r.from_node, to: r.to_node, relation: r.relation }));
  }
  upsertClaim(c: Claim): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_claims
      (claim_id, text, node_id, status, corroborating_sources, credibility, provenance) VALUES (?,?,?,?,?,?,?)`)
      .run(c.claim_id, c.text, c.node_id, c.status, JSON.stringify(c.corroborating_sources),
        c.credibility ? JSON.stringify(c.credibility) : null, JSON.stringify(c.provenance));
  }
  listClaims(): Claim[] {
    return (this.db.prepare(`SELECT * FROM kg_claims`).all() as any[]).map((r) => ({
      claim_id: r.claim_id, text: r.text, node_id: r.node_id, status: r.status,
      corroborating_sources: JSON.parse(r.corroborating_sources || '[]'),
      credibility: r.credibility ? JSON.parse(r.credibility) : undefined, provenance: JSON.parse(r.provenance),
    }));
  }

  // ── Acquired content ──────────────────────────────────────────────────────
  putContent(ref: string, text: string, retrievedAt: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_content (content_ref, text, retrieved_at) VALUES (?,?,?)`).run(ref, text, retrievedAt);
  }
  getContent(ref: string): string | null {
    const r = this.db.prepare(`SELECT text FROM kg_content WHERE content_ref=?`).get(ref) as any;
    return r ? r.text : null;
  }

  // ── Codebase index / contrast ─────────────────────────────────────────────
  upsertCodebaseUnit(u: CodebaseUnit & { embedding?: number[]; file_hash?: string }): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_codebase_units (unit_id, path, symbol, capability_summary, embedding, file_hash)
      VALUES (?,?,?,?,?,?)`).run(u.unit_id, u.path, u.symbol, u.capability_summary,
        u.embedding ? JSON.stringify(u.embedding) : null, u.file_hash ?? null);
  }
  listCodebaseUnits(): Array<CodebaseUnit & { embedding?: number[] }> {
    return (this.db.prepare(`SELECT * FROM kg_codebase_units`).all() as any[]).map((r) => ({
      unit_id: r.unit_id, path: r.path, symbol: r.symbol, capability_summary: r.capability_summary,
      embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
    }));
  }
  addContrast(v: ContrastVerdict): void {
    this.db.prepare(`INSERT INTO kg_contrast (finding_ref, verdict, codebase_unit, rationale, confidence) VALUES (?,?,?,?,?)`)
      .run(v.finding_ref, v.verdict, v.codebase_unit ?? null, v.rationale, v.confidence);
  }

  // ── Reports / mission state ───────────────────────────────────────────────
  saveReport(r: DawnReport): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_reports (report_id, mission_id, generated_at, json) VALUES (?,?,?,?)`)
      .run(r.report_id, r.mission_id, r.generated_at, JSON.stringify(r));
  }
  saveMissionState(s: MissionState): void {
    this.db.prepare(`INSERT OR REPLACE INTO kg_mission_state (mission_id, phase, json, updated_at) VALUES (?,?,?,?)`)
      .run(s.mission_id, s.phase, JSON.stringify(s), s.updatedAt);
  }
  loadMissionState(missionId: string): MissionState | null {
    const r = this.db.prepare(`SELECT json FROM kg_mission_state WHERE mission_id=?`).get(missionId) as any;
    return r ? (JSON.parse(r.json) as MissionState) : null;
  }

  close(): void { this.db.close(); }
}

function rowToTranscript(r: any): Transcript {
  return {
    transcript_id: r.transcript_id, video_id: r.video_id, channel_id: r.channel_id, title: r.title,
    lang: r.lang, published_at: r.published_at ?? undefined, text: r.text, token_count: r.token_count,
    provenance: JSON.parse(r.provenance), ingested_at: r.ingested_at,
  };
}

// ── Shared singleton ──────────────────────────────────────────────────────────
let _shared: KagemushaStore | null = null;
export function sharedKagemushaStore(): KagemushaStore {
  if (!_shared) _shared = new KagemushaStore();
  return _shared;
}
