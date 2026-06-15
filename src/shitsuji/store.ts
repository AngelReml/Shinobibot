/**
 * shitsuji/store.ts — T-02: persist the butler's work (dossier §6). New, idempotent
 * tables in a sibling DB (shitsuji.db), same migration pattern as the other dojo
 * stores: CREATE IF NOT EXISTS so a fresh DB is created, a legacy DB isn't broken,
 * and a re-run is a no-op. Stores the Intent, the Plan, the PlanResult, and the
 * chained TEV trace — so a run is auditable after the fact (V3) and the chain can
 * be verified without trusting Shinobi.
 *
 * Nested structures (goals/steps/...) are kept as a JSON blob alongside the indexed
 * key columns — the shape is read back whole, queried by id.
 */

import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Intent, Plan, PlanResult, TEVEntry } from './types.js';

export interface ShitsujiStoreOptions { db_path?: string; }

export interface TevChainVerdict { ok: boolean; length: number; broken_at?: string; detail: string; }

export class ShitsujiStore {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(options: ShitsujiStoreOptions = {}) {
    if (options.db_path) {
      this.dbPath = options.db_path;
    } else {
      const dir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.dbPath = path.join(dir, 'shitsuji.db');
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sh_intent (
        intent_id TEXT PRIMARY KEY, raw_utterance TEXT, json TEXT, created_at TEXT );
      CREATE TABLE IF NOT EXISTS sh_plan (
        plan_id TEXT PRIMARY KEY, intent_id TEXT, feasible INTEGER, json TEXT, created_at TEXT );
      CREATE INDEX IF NOT EXISTS idx_sh_plan_intent ON sh_plan(intent_id);
      CREATE TABLE IF NOT EXISTS sh_result (
        plan_id TEXT PRIMARY KEY, status TEXT, honest_summary TEXT, tev_ref TEXT, json TEXT, created_at TEXT );
      CREATE TABLE IF NOT EXISTS sh_tev (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT, step_id TEXT,
        prev_hash TEXT, this_hash TEXT, json TEXT, recorded_at TEXT );
      CREATE INDEX IF NOT EXISTS idx_sh_tev_plan ON sh_tev(plan_id);
    `);
  }

  saveIntent(intent: Intent, ts: string): void {
    this.db.prepare(`INSERT INTO sh_intent (intent_id, raw_utterance, json, created_at) VALUES (?,?,?,?)
      ON CONFLICT(intent_id) DO UPDATE SET raw_utterance=excluded.raw_utterance, json=excluded.json`)
      .run(intent.intent_id, intent.raw_utterance, JSON.stringify(intent), ts);
  }
  getIntent(id: string): Intent | null {
    const r = this.db.prepare(`SELECT json FROM sh_intent WHERE intent_id=?`).get(id) as any;
    return r ? JSON.parse(r.json) as Intent : null;
  }

  savePlan(plan: Plan, ts: string): void {
    this.db.prepare(`INSERT INTO sh_plan (plan_id, intent_id, feasible, json, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(plan_id) DO UPDATE SET feasible=excluded.feasible, json=excluded.json`)
      .run(plan.plan_id, plan.intent_id, plan.feasible ? 1 : 0, JSON.stringify(plan), ts);
  }
  getPlan(id: string): Plan | null {
    const r = this.db.prepare(`SELECT json FROM sh_plan WHERE plan_id=?`).get(id) as any;
    return r ? JSON.parse(r.json) as Plan : null;
  }

  saveResult(result: PlanResult, ts: string): void {
    this.db.prepare(`INSERT INTO sh_result (plan_id, status, honest_summary, tev_ref, json, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(plan_id) DO UPDATE SET status=excluded.status, honest_summary=excluded.honest_summary, tev_ref=excluded.tev_ref, json=excluded.json`)
      .run(result.plan_id, result.status, result.honest_summary, result.tev_ref ?? null, JSON.stringify(result), ts);
  }
  getResult(planId: string): PlanResult | null {
    const r = this.db.prepare(`SELECT json FROM sh_result WHERE plan_id=?`).get(planId) as any;
    return r ? JSON.parse(r.json) as PlanResult : null;
  }

  /** Append the chained TEV entries for a plan (V3). Order preserved by seq. */
  appendTev(planId: string, entries: TEVEntry[], ts: string): void {
    const stmt = this.db.prepare(`INSERT INTO sh_tev (plan_id, step_id, prev_hash, this_hash, json, recorded_at) VALUES (?,?,?,?,?,?)`);
    const tx = this.db.transaction(() => {
      for (const e of entries) stmt.run(planId, e.step_id, e.prev_hash, e.this_hash, JSON.stringify(e), ts);
    });
    tx();
  }
  loadTev(planId: string): TEVEntry[] {
    return (this.db.prepare(`SELECT json FROM sh_tev WHERE plan_id=? ORDER BY seq`).all(planId) as any[])
      .map((r) => JSON.parse(r.json) as TEVEntry);
  }

  /**
   * Verify the TEV chain LINKAGE for a plan: first entry chains from 'genesis',
   * each subsequent prev_hash equals the previous this_hash, and every this_hash is
   * present. (The ed25519 SIGNING of each entry is ⚠ FASE D — pending; this is the
   * deterministic chain-link integrity a third party can already check.)
   */
  verifyTevChain(planId: string): TevChainVerdict {
    const chain = this.loadTev(planId);
    if (chain.length === 0) return { ok: true, length: 0, detail: 'cadena vacía (plan sin pasos ejecutados)' };
    let prev = 'genesis';
    for (const e of chain) {
      if (e.prev_hash !== prev) return { ok: false, length: chain.length, broken_at: e.step_id, detail: `eslabón roto en ${e.step_id}: prev_hash "${e.prev_hash}" ≠ esperado "${prev}"` };
      if (!e.this_hash) return { ok: false, length: chain.length, broken_at: e.step_id, detail: `entrada ${e.step_id} sin this_hash` };
      prev = e.this_hash;
    }
    return { ok: true, length: chain.length, detail: `cadena íntegra de ${chain.length} eslabones` };
  }

  close(): void { this.db.close(); }
}

let _shared: ShitsujiStore | null = null;
export function sharedShitsujiStore(): ShitsujiStore { if (!_shared) _shared = new ShitsujiStore(); return _shared; }
