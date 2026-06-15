/**
 * chizu/store.ts — M-02: versioned persistence of the map (own sibling DB, chizu.db,
 * idempotent CREATE-IF-NOT-EXISTS). The Atlas is versioned by SCAN: each scan is a
 * dated snapshot of the machine, so the map's evolution is auditable and a re-scan
 * never silently overwrites history. AppCards are stored per scan; the latest scan
 * is the live Atlas.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AppCard } from './types.js';

export interface ChizuStoreOptions { db_path?: string; }

export class ChizuStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: ChizuStoreOptions = {}) {
    if (options.db_path) {
      this.dbPath = options.db_path;
    } else {
      const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.dbPath = path.join(dir, 'chizu.db');
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cz_scan (
        scan_id TEXT PRIMARY KEY, created_at TEXT, card_count INTEGER );
      CREATE TABLE IF NOT EXISTS cz_app (
        scan_id TEXT, app_id TEXT, display_name TEXT, category TEXT, risk_level TEXT, json TEXT,
        PRIMARY KEY (scan_id, app_id) );
      CREATE INDEX IF NOT EXISTS idx_cz_app_scan ON cz_app(scan_id);
    `);
  }

  /** Persist a scan: the scan row + all its AppCards (idempotent upsert per card). */
  saveScan(scanId: string, cards: AppCard[], createdAt: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO cz_scan (scan_id, created_at, card_count) VALUES (?,?,?)
        ON CONFLICT(scan_id) DO UPDATE SET created_at=excluded.created_at, card_count=excluded.card_count`)
        .run(scanId, createdAt, cards.length);
      const stmt = this.db.prepare(`INSERT INTO cz_app (scan_id, app_id, display_name, category, risk_level, json) VALUES (?,?,?,?,?,?)
        ON CONFLICT(scan_id, app_id) DO UPDATE SET display_name=excluded.display_name, category=excluded.category, risk_level=excluded.risk_level, json=excluded.json`);
      for (const c of cards) stmt.run(scanId, c.app_id, c.display_name, c.category, c.risk.level, JSON.stringify(c));
    });
    tx();
  }

  latestScanId(): string | null {
    const r = this.db.prepare(`SELECT scan_id FROM cz_scan ORDER BY created_at DESC, scan_id DESC LIMIT 1`).get() as any;
    return r?.scan_id ?? null;
  }

  /** Load an Atlas's cards (the latest scan if scanId omitted). */
  loadAtlas(scanId?: string): AppCard[] {
    const id = scanId ?? this.latestScanId();
    if (!id) return [];
    return (this.db.prepare(`SELECT json FROM cz_app WHERE scan_id=? ORDER BY display_name`).all(id) as any[])
      .map((r) => JSON.parse(r.json) as AppCard);
  }

  listScans(): { scan_id: string; created_at: string; card_count: number }[] {
    return this.db.prepare(`SELECT scan_id, created_at, card_count FROM cz_scan ORDER BY created_at`).all() as any[];
  }

  close(): void { this.db.close(); }
}

let _shared: ChizuStore | null = null;
export function sharedChizuStore(): ChizuStore { if (!_shared) _shared = new ChizuStore(); return _shared; }
