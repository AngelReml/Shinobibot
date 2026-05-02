import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

export interface RecurrentMission {
  id: string;
  name: string;
  prompt: string;
  cron_seconds: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: 'success' | 'failure' | 'pending' | null;
  last_output: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export class MissionsStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultDir = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    this.db = new Database(dbPath || path.join(defaultDir, 'missions.db'));
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions_recurrent (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron_seconds INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_status TEXT,
        last_output TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_missions_enabled ON missions_recurrent(enabled);

      CREATE TABLE IF NOT EXISTS mission_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_mission ON mission_logs(mission_id, started_at DESC);
    `);
  }

  public create(input: { name: string; prompt: string; cron_seconds: number }): RecurrentMission {
    const id = `mis_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO missions_recurrent (id, name, prompt, cron_seconds, enabled, last_run_at, last_status, last_output, consecutive_failures, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, NULL, NULL, NULL, 0, ?, ?)
    `).run(id, input.name, input.prompt, input.cron_seconds, now, now);
    return this.get(id)!;
  }

  public list(onlyEnabled = false): RecurrentMission[] {
    const sql = onlyEnabled
      ? 'SELECT * FROM missions_recurrent WHERE enabled = 1 ORDER BY created_at DESC'
      : 'SELECT * FROM missions_recurrent ORDER BY created_at DESC';
    return (this.db.prepare(sql).all() as any[]).map(r => this.fromRow(r));
  }

  public get(id: string): RecurrentMission | null {
    const row = this.db.prepare('SELECT * FROM missions_recurrent WHERE id = ?').get(id);
    return row ? this.fromRow(row as any) : null;
  }

  public setEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE missions_recurrent SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  public delete(id: string): boolean {
    const r = this.db.prepare('DELETE FROM missions_recurrent WHERE id = ?').run(id);
    return r.changes > 0;
  }

  public recordRun(id: string, status: 'success' | 'failure', output: string | null, error: string | null = null): void {
    const now = new Date().toISOString();
    const current = this.get(id);
    if (!current) return;
    const newFailures = status === 'success' ? 0 : current.consecutive_failures + 1;
    this.db.prepare(`
      UPDATE missions_recurrent
      SET last_run_at = ?, last_status = ?, last_output = ?, consecutive_failures = ?, updated_at = ?
      WHERE id = ?
    `).run(now, status, (output || '').substring(0, 4000), newFailures, now, id);

    this.db.prepare(`
      INSERT INTO mission_logs (mission_id, started_at, finished_at, status, output, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, now, now, status, (output || '').substring(0, 8000), error);
  }

  public getDueMissions(now: Date = new Date()): RecurrentMission[] {
    const all = this.list(true);
    return all.filter(m => {
      if (m.consecutive_failures >= 3) return false; // circuit breaker
      if (!m.last_run_at) return true;
      const last = new Date(m.last_run_at).getTime();
      return now.getTime() - last >= m.cron_seconds * 1000;
    });
  }

  public getRecentLogs(missionId: string, limit = 10): any[] {
    return this.db.prepare(`SELECT * FROM mission_logs WHERE mission_id = ? ORDER BY started_at DESC LIMIT ?`).all(missionId, limit) as any[];
  }

  public resetFailures(id: string): void {
    this.db.prepare('UPDATE missions_recurrent SET consecutive_failures = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  private fromRow(r: any): RecurrentMission {
    return {
      id: r.id, name: r.name, prompt: r.prompt, cron_seconds: r.cron_seconds,
      enabled: !!r.enabled, last_run_at: r.last_run_at, last_status: r.last_status,
      last_output: r.last_output, consecutive_failures: r.consecutive_failures,
      created_at: r.created_at, updated_at: r.updated_at
    };
  }

  public close(): void { this.db.close(); }
}
