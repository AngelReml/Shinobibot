/**
 * kaname/store.ts — persistencia del Kaname (kaname.db, idempotente). El MOTOR es
 * núcleo; los DATOS son userspace (§4): el catálogo de skills, las versiones de
 * núcleo y los registros del enjambre. Mismo patrón CREATE-IF-NOT-EXISTS del resto.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { SkillRecord, KernelVersion, SwarmWorker } from './types.js';

export interface KanameStoreOptions { db_path?: string; }

export class KanameStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: KanameStoreOptions = {}) {
    if (options.db_path) this.dbPath = options.db_path;
    else {
      const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.dbPath = path.join(dir, 'kaname.db');
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kn_skill (
        skill_id TEXT PRIMARY KEY, csv_ref TEXT, manifest_ref TEXT, status TEXT, created_by TEXT, isolation TEXT, json TEXT );
      CREATE INDEX IF NOT EXISTS idx_kn_skill_status ON kn_skill(status);
      CREATE TABLE IF NOT EXISTS kn_version (
        version TEXT PRIMARY KEY, hash TEXT, promoted_at TEXT, dojo_hard_tests TEXT, json TEXT );
      CREATE TABLE IF NOT EXISTS kn_worker (
        worker_id TEXT PRIMARY KEY, role TEXT, assigned_front TEXT, status TEXT, json TEXT );
    `);
  }

  // Catálogo de skills (userspace)
  upsertSkill(r: SkillRecord): void {
    this.db.prepare(`INSERT INTO kn_skill (skill_id, csv_ref, manifest_ref, status, created_by, isolation, json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET status=excluded.status, csv_ref=excluded.csv_ref, json=excluded.json`)
      .run(r.skill_id, r.csv_ref, r.manifest_ref, r.status, r.created_by, r.isolation, JSON.stringify(r));
  }
  getSkill(id: string): SkillRecord | null {
    const row = this.db.prepare(`SELECT json FROM kn_skill WHERE skill_id=?`).get(id) as any;
    return row ? JSON.parse(row.json) as SkillRecord : null;
  }
  listSkills(status?: SkillRecord['status']): SkillRecord[] {
    const rows = (status ? this.db.prepare(`SELECT json FROM kn_skill WHERE status=?`).all(status) : this.db.prepare(`SELECT json FROM kn_skill`).all()) as any[];
    return rows.map((r) => JSON.parse(r.json) as SkillRecord);
  }

  // Versiones de núcleo
  saveVersion(v: KernelVersion): void {
    this.db.prepare(`INSERT INTO kn_version (version, hash, promoted_at, dojo_hard_tests, json) VALUES (?,?,?,?,?)
      ON CONFLICT(version) DO UPDATE SET hash=excluded.hash, promoted_at=excluded.promoted_at, dojo_hard_tests=excluded.dojo_hard_tests, json=excluded.json`)
      .run(v.version, v.hash, v.promoted_at, v.dojo_hard_tests, JSON.stringify(v));
  }
  listVersions(): KernelVersion[] {
    return (this.db.prepare(`SELECT json FROM kn_version ORDER BY promoted_at`).all() as any[]).map((r) => JSON.parse(r.json) as KernelVersion);
  }
  latestVersion(): KernelVersion | null {
    const r = this.db.prepare(`SELECT json FROM kn_version ORDER BY promoted_at DESC, version DESC LIMIT 1`).get() as any;
    return r ? JSON.parse(r.json) as KernelVersion : null;
  }

  // Registros del enjambre
  upsertWorker(w: SwarmWorker): void {
    this.db.prepare(`INSERT INTO kn_worker (worker_id, role, assigned_front, status, json) VALUES (?,?,?,?,?)
      ON CONFLICT(worker_id) DO UPDATE SET status=excluded.status, json=excluded.json`)
      .run(w.worker_id, w.role, w.assigned_front, w.status, JSON.stringify(w));
  }
  listWorkers(): SwarmWorker[] {
    return (this.db.prepare(`SELECT json FROM kn_worker`).all() as any[]).map((r) => JSON.parse(r.json) as SwarmWorker);
  }

  close(): void { this.db.close(); }
}

let _shared: KanameStore | null = null;
export function sharedKanameStore(): KanameStore { if (!_shared) _shared = new KanameStore(); return _shared; }
