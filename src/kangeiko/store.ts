/**
 * kangeiko/store.ts — persist the capability curve (across nights) + the
 * repertoire (KG-04). Same idempotent-migration pattern as the other dojo stores;
 * own sibling DB (kangeiko.db). The curve is a continuous record so progress is
 * visible night over night; the repertoire carries each skill's status so
 * consolidation (active/archived/discarded) is durable.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CurvePoint } from './types.js';
import type { RepertoireEntry } from './consolidate.js';

export interface KangeikoStoreOptions { db_path?: string; }

export class KangeikoStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: KangeikoStoreOptions = {}) {
    const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.dbPath = options.db_path || path.join(dir, 'kangeiko.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kk_curve (
        id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, cycle INTEGER,
        passed INTEGER, total INTEGER, recorded_at TEXT );
      CREATE INDEX IF NOT EXISTS idx_kk_curve_domain ON kk_curve(domain);
      CREATE TABLE IF NOT EXISTS kk_repertoire (
        skill_id TEXT PRIMARY KEY, capability_id TEXT, grade TEXT, version INTEGER,
        certified_at TEXT, status TEXT );
      CREATE INDEX IF NOT EXISTS idx_kk_rep_cap ON kk_repertoire(capability_id);
    `);
  }

  recordCurvePoint(domain: string, p: CurvePoint, recordedAt: string): void {
    this.db.prepare(`INSERT INTO kk_curve (domain, cycle, passed, total, recorded_at) VALUES (?,?,?,?,?)`)
      .run(domain, p.cycle, p.passed, p.total, recordedAt);
  }
  loadCurve(domain: string): CurvePoint[] {
    return (this.db.prepare(`SELECT cycle, passed, total FROM kk_curve WHERE domain=? ORDER BY id`).all(domain) as any[])
      .map((r) => ({ cycle: r.cycle, passed: r.passed, total: r.total }));
  }

  upsertSkill(e: RepertoireEntry): void {
    this.db.prepare(`INSERT INTO kk_repertoire (skill_id, capability_id, grade, version, certified_at, status)
      VALUES (?,?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET grade=excluded.grade, version=excluded.version,
      certified_at=excluded.certified_at, status=excluded.status`)
      .run(e.skill_id, e.capability_id, e.grade, e.version, e.certified_at, e.status);
  }
  listRepertoire(status?: RepertoireEntry['status']): RepertoireEntry[] {
    const rows = (status
      ? this.db.prepare(`SELECT * FROM kk_repertoire WHERE status=?`).all(status)
      : this.db.prepare(`SELECT * FROM kk_repertoire`).all()) as any[];
    return rows.map((r) => ({ skill_id: r.skill_id, capability_id: r.capability_id, grade: r.grade, version: r.version, certified_at: r.certified_at, status: r.status }));
  }
  /** Persist a consolidation result (active/archived/dropped statuses). */
  applyConsolidation(res: { active: RepertoireEntry[]; archived: RepertoireEntry[]; dropped: RepertoireEntry[] }): void {
    const tx = this.db.transaction(() => {
      for (const e of [...res.active, ...res.archived, ...res.dropped]) this.upsertSkill(e);
    });
    tx();
  }

  close(): void { this.db.close(); }
}

let _shared: KangeikoStore | null = null;
export function sharedKangeikoStore(): KangeikoStore { if (!_shared) _shared = new KangeikoStore(); return _shared; }
