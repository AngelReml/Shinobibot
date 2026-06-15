/**
 * kagami/store.ts — K-02: durable persistence for the mirror (own sibling DB,
 * kagami.db, same idempotent CREATE-IF-NOT-EXISTS pattern as the other dojo
 * stores). Persists what must survive across nights so progress and calibration
 * are visible over time:
 *   - CodeHealthSnapshot history (Pillar A) → the health TREND.
 *   - CapabilityCell frontier map (Pillar B) → reliable/shaky/beyond over time.
 *   - LearningSession + exams (Pillar C) → demonstrated mastery, anchored.
 *   - CalibrationRecord (the soul) → brier + over/under-confidence over time.
 * Nested structures kept as a JSON blob beside the indexed key columns.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CodeHealthSnapshot, CapabilityCell, LearningSession, CalibrationRecord } from './types.js';

export interface KagamiStoreOptions { db_path?: string; }

export class KagamiStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: KagamiStoreOptions = {}) {
    if (options.db_path) {
      this.dbPath = options.db_path;
    } else {
      const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.dbPath = path.join(dir, 'kagami.db');
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_snapshot (
        snapshot_id TEXT PRIMARY KEY, taken_at TEXT, passed INTEGER, failed INTEGER,
        typecheck_errors INTEGER, coverage_overall REAL, json TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_snapshot_at ON kg_snapshot(taken_at);
      CREATE TABLE IF NOT EXISTS kg_capability (
        capability_id TEXT PRIMARY KEY, category TEXT, success_rate REAL,
        declared_confidence REAL, calibration_gap REAL, verdict TEXT, measured_at TEXT, json TEXT );
      CREATE TABLE IF NOT EXISTS kg_session (
        session_id TEXT PRIMARY KEY, skill TEXT, declared_mastery INTEGER, json TEXT, updated_at TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_session_skill ON kg_session(skill);
      CREATE TABLE IF NOT EXISTS kg_calibration (
        record_id TEXT PRIMARY KEY, scope TEXT, brier_score REAL,
        overconfidence REAL, underconfidence REAL, computed_at TEXT, json TEXT );
      CREATE INDEX IF NOT EXISTS idx_kg_calib_scope ON kg_calibration(scope);
    `);
  }

  // Pillar A — snapshots + trend
  saveSnapshot(s: CodeHealthSnapshot): void {
    this.db.prepare(`INSERT INTO kg_snapshot (snapshot_id, taken_at, passed, failed, typecheck_errors, coverage_overall, json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(snapshot_id) DO UPDATE SET json=excluded.json, taken_at=excluded.taken_at`)
      .run(s.snapshot_id, s.taken_at, s.suite.passed, s.suite.failed, s.typecheck_errors, s.coverage_overall ?? null, JSON.stringify(s));
  }
  /** Snapshots in chronological order (the trend), optionally the last N. */
  loadSnapshots(limit?: number): CodeHealthSnapshot[] {
    const rows = (limit
      ? this.db.prepare(`SELECT json FROM kg_snapshot ORDER BY taken_at DESC LIMIT ?`).all(limit)
      : this.db.prepare(`SELECT json FROM kg_snapshot ORDER BY taken_at`).all()) as any[];
    const out = rows.map((r) => JSON.parse(r.json) as CodeHealthSnapshot);
    return limit ? out.reverse() : out;   // most-recent-N but returned oldest→newest
  }

  // Pillar B — frontier map
  upsertCapability(c: CapabilityCell): void {
    this.db.prepare(`INSERT INTO kg_capability (capability_id, category, success_rate, declared_confidence, calibration_gap, verdict, measured_at, json)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(capability_id) DO UPDATE SET success_rate=excluded.success_rate,
      declared_confidence=excluded.declared_confidence, calibration_gap=excluded.calibration_gap,
      verdict=excluded.verdict, measured_at=excluded.measured_at, json=excluded.json`)
      .run(c.capability_id, c.category, c.success_rate, c.declared_confidence, c.calibration_gap, c.verdict, c.measured_at, JSON.stringify(c));
  }
  loadFrontier(verdict?: CapabilityCell['verdict']): CapabilityCell[] {
    const rows = (verdict
      ? this.db.prepare(`SELECT json FROM kg_capability WHERE verdict=?`).all(verdict)
      : this.db.prepare(`SELECT json FROM kg_capability`).all()) as any[];
    return rows.map((r) => JSON.parse(r.json) as CapabilityCell);
  }

  // Pillar C — learning sessions
  saveSession(s: LearningSession, updatedAt: string): void {
    this.db.prepare(`INSERT INTO kg_session (session_id, skill, declared_mastery, json, updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET declared_mastery=excluded.declared_mastery, json=excluded.json, updated_at=excluded.updated_at`)
      .run(s.session_id, s.skill, s.declared_mastery ? 1 : 0, JSON.stringify(s), updatedAt);
  }
  getSession(id: string): LearningSession | null {
    const r = this.db.prepare(`SELECT json FROM kg_session WHERE session_id=?`).get(id) as any;
    return r ? JSON.parse(r.json) as LearningSession : null;
  }

  // The soul — calibration
  saveCalibration(c: CalibrationRecord): void {
    this.db.prepare(`INSERT INTO kg_calibration (record_id, scope, brier_score, overconfidence, underconfidence, computed_at, json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET brier_score=excluded.brier_score,
      overconfidence=excluded.overconfidence, underconfidence=excluded.underconfidence, computed_at=excluded.computed_at, json=excluded.json`)
      .run(c.record_id, c.scope, c.brier_score, c.overconfidence, c.underconfidence, c.computed_at, JSON.stringify(c));
  }
  loadCalibration(scope?: CalibrationRecord['scope']): CalibrationRecord[] {
    const rows = (scope
      ? this.db.prepare(`SELECT json FROM kg_calibration WHERE scope=? ORDER BY computed_at`).all(scope)
      : this.db.prepare(`SELECT json FROM kg_calibration ORDER BY computed_at`).all()) as any[];
    return rows.map((r) => JSON.parse(r.json) as CalibrationRecord);
  }

  close(): void { this.db.close(); }
}

let _shared: KagamiStore | null = null;
export function sharedKagamiStore(): KagamiStore { if (!_shared) _shared = new KagamiStore(); return _shared; }
