import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { isDue, parseTrigger, type MissionTrigger } from '../runtime/mission_scheduler.js';

export interface RecurrentMission {
  id: string;
  name: string;
  prompt: string;
  cron_seconds: number;
  /**
   * Trigger rico (interval/daily/weekly/cron) serializado como JSON. Si está
   * presente, tiene prioridad sobre `cron_seconds`. Si no, se usa el
   * comportamiento legacy (intervalo fijo en segundos).
   */
  trigger_json: string | null;
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
    // Migration idempotente: añade trigger_json si la DB es vieja. PRAGMA
    // table_info nos dice qué columnas existen ya.
    const cols = (this.db.prepare(`PRAGMA table_info(missions_recurrent)`).all() as any[]).map(r => r.name);
    if (!cols.includes('trigger_json')) {
      this.db.exec(`ALTER TABLE missions_recurrent ADD COLUMN trigger_json TEXT`);
    }
  }

  public create(input: { name: string; prompt: string; cron_seconds: number; trigger?: MissionTrigger }): RecurrentMission {
    const id = `mis_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    // Validamos el trigger fail-fast (lanza si malformado) y serializamos.
    let triggerJson: string | null = null;
    if (input.trigger) {
      const validated = parseTrigger(input.trigger);
      triggerJson = JSON.stringify(serializeTrigger(validated));
    }
    this.db.prepare(`
      INSERT INTO missions_recurrent (id, name, prompt, cron_seconds, trigger_json, enabled, last_run_at, last_status, last_output, consecutive_failures, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, NULL, 0, ?, ?)
    `).run(id, input.name, input.prompt, input.cron_seconds, triggerJson, now, now);
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
      // Si la misión tiene trigger rico, lo evaluamos con el scheduler puro.
      if (m.trigger_json) {
        try {
          const trigger = parseTrigger(JSON.parse(m.trigger_json));
          return isDue(trigger, m.last_run_at, now);
        } catch {
          // Trigger corrupto → fallback al cron_seconds legacy.
        }
      }
      // Legacy: intervalo en segundos.
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
      trigger_json: r.trigger_json ?? null,
      enabled: !!r.enabled, last_run_at: r.last_run_at, last_status: r.last_status,
      last_output: r.last_output, consecutive_failures: r.consecutive_failures,
      created_at: r.created_at, updated_at: r.updated_at
    };
  }

  public close(): void { this.db.close(); }
}

/**
 * Serializa un MissionTrigger validado a su forma JSON minimalista
 * (lo que `parseTrigger` espera leer). Para cron, devolvemos la expr
 * original como string (no la AST parseada) para que el ciclo
 * write→read→parse sea cerrado.
 */
function serializeTrigger(trigger: MissionTrigger): any {
  if (trigger.kind === 'cron') {
    // Necesitamos preservar la expr original. Como parseTrigger acepta
    // {kind:'cron', expr:'string'}, almacenamos la expr ya canónica.
    // Reconstruimos un string canónico a partir del AST.
    const f = (field: any): string => field.kind === 'any' ? '*' : field.values.join(',');
    const expr = trigger.expr;
    const canonical = `${f(expr.minute)} ${f(expr.hour)} ${f(expr.day)} ${f(expr.month)} ${f(expr.weekday)}`;
    return { kind: 'cron', expr: canonical };
  }
  return trigger;
}
