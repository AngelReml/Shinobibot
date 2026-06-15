/**
 * shugyo/store.ts — S-02: durable persistence for the explorer (own sibling DB,
 * shugyo.db, idempotent CREATE-IF-NOT-EXISTS). Persists:
 *   - LearnedSkill candidates/certified (the distilled skills, before they reach
 *     Kangeiko's active repertoire);
 *   - TransferablePattern (the PatternBook seed) → the descending curve survives
 *     across sessions, so each program learned still cheapens the next tomorrow.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PatternBook } from './curve/patternbook.js';
import type { LearnedSkill, TransferablePattern } from './types.js';

export interface ShugyoStoreOptions { db_path?: string; }

export class ShugyoStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: ShugyoStoreOptions = {}) {
    if (options.db_path) {
      this.dbPath = options.db_path;
    } else {
      const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.dbPath = path.join(dir, 'shugyo.db');
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sg_skill (
        skill_id TEXT PRIMARY KEY, app_id TEXT, capability_id TEXT, status TEXT, grade TEXT, json TEXT );
      CREATE INDEX IF NOT EXISTS idx_sg_skill_app ON sg_skill(app_id);
      CREATE TABLE IF NOT EXISTS sg_pattern (
        idiom TEXT PRIMARY KEY, hit_rate REAL, json TEXT );
    `);
  }

  upsertSkill(s: LearnedSkill): void {
    this.db.prepare(`INSERT INTO sg_skill (skill_id, app_id, capability_id, status, grade, json) VALUES (?,?,?,?,?,?)
      ON CONFLICT(skill_id) DO UPDATE SET status=excluded.status, grade=excluded.grade, json=excluded.json`)
      .run(s.skill_id, s.app_id, s.capability_id, s.status, s.grade, JSON.stringify(s));
  }
  listSkills(status?: LearnedSkill['status']): LearnedSkill[] {
    const rows = (status
      ? this.db.prepare(`SELECT json FROM sg_skill WHERE status=?`).all(status)
      : this.db.prepare(`SELECT json FROM sg_skill`).all()) as any[];
    return rows.map((r) => JSON.parse(r.json) as LearnedSkill);
  }

  savePattern(p: TransferablePattern): void {
    this.db.prepare(`INSERT INTO sg_pattern (idiom, hit_rate, json) VALUES (?,?,?)
      ON CONFLICT(idiom) DO UPDATE SET hit_rate=excluded.hit_rate, json=excluded.json`)
      .run(p.idiom, p.hit_rate, JSON.stringify(p));
  }
  loadPatterns(): TransferablePattern[] {
    return (this.db.prepare(`SELECT json FROM sg_pattern ORDER BY hit_rate DESC`).all() as any[]).map((r) => JSON.parse(r.json) as TransferablePattern);
  }
  /** Rehydrate a PatternBook seeded from the persisted patterns (the curve survives). */
  loadPatternBook(): PatternBook { return new PatternBook(this.loadPatterns()); }

  close(): void { this.db.close(); }
}

let _shared: ShugyoStore | null = null;
export function sharedShugyoStore(): ShugyoStore { if (!_shared) _shared = new ShugyoStore(); return _shared; }
