import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MissionsStore } from '../missions_recurrent.js';

let dbDir: string;
let dbPath: string;
let store: MissionsStore;

beforeEach(() => {
  dbDir = join(tmpdir(), `shinobi-missions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dbDir, { recursive: true });
  dbPath = join(dbDir, 'missions.db');
  store = new MissionsStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch {}
  try { if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true }); } catch {}
});

describe('MissionsStore — backward compat (cron_seconds)', () => {
  it('crea misión con cron_seconds y la detecta como due', () => {
    const m = store.create({ name: 'tick', prompt: 'hola', cron_seconds: 60 });
    expect(m.cron_seconds).toBe(60);
    expect(m.trigger_json).toBeNull();
    const due = store.getDueMissions();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(m.id);
  });

  it('después de recordRun no está due antes de 60s', () => {
    const m = store.create({ name: 'tick', prompt: 'hola', cron_seconds: 60 });
    store.recordRun(m.id, 'success', 'ok');
    const due = store.getDueMissions();
    expect(due).toHaveLength(0);
  });
});

describe('MissionsStore — triggers ricos', () => {
  it('persiste trigger_json y lo restaura', () => {
    const m = store.create({
      name: 'daily-9am',
      prompt: 'morning brief',
      cron_seconds: 0,
      trigger: { kind: 'daily', at: '09:00' },
    });
    expect(m.trigger_json).toBeTruthy();
    const restored = store.get(m.id)!;
    const parsed = JSON.parse(restored.trigger_json!);
    expect(parsed).toEqual({ kind: 'daily', at: '09:00' });
  });

  it('trigger interval con cron_seconds=0 funciona porque domina el trigger', () => {
    // Si trigger está, cron_seconds se ignora.
    store.create({
      name: 'every-30s',
      prompt: 'p',
      cron_seconds: 9999, // valor irrelevante cuando hay trigger
      trigger: { kind: 'interval', seconds: 30 },
    });
    expect(store.getDueMissions()).toHaveLength(1); // nunca corrió, due
  });

  it('cron serializado round-trip', () => {
    // El input usa expr como string (forma que parseTrigger acepta). La
    // store lo canonicaliza a `0 9 * * 1` y lo escribe.
    const m = store.create({
      name: 'every-monday-9',
      prompt: 'p',
      cron_seconds: 0,
      trigger: { kind: 'cron', expr: '0 9 * * 1' } as any,
    });
    const restored = store.get(m.id)!;
    const parsed = JSON.parse(restored.trigger_json!);
    expect(parsed.kind).toBe('cron');
    expect(parsed.expr).toBe('0 9 * * 1');
  });

  it('trigger malformado lanza al crear', () => {
    expect(() => store.create({
      name: 'x',
      prompt: 'p',
      cron_seconds: 0,
      trigger: { kind: 'daily', at: 'not-a-time' } as any,
    })).toThrow();
  });

  it('getDueMissions usa isDue cuando hay trigger', () => {
    // Trigger interval de 30s. Si nunca corrió → due.
    store.create({
      name: 'i',
      prompt: 'p',
      cron_seconds: 0,
      trigger: { kind: 'interval', seconds: 30 },
    });
    expect(store.getDueMissions()).toHaveLength(1);
  });

  it('circuit breaker tras 3 fallos consecutivos sigue aplicando con trigger rico', () => {
    const m = store.create({
      name: 'flaky',
      prompt: 'p',
      cron_seconds: 0,
      trigger: { kind: 'interval', seconds: 1 },
    });
    store.recordRun(m.id, 'failure', null, 'e1');
    store.recordRun(m.id, 'failure', null, 'e2');
    store.recordRun(m.id, 'failure', null, 'e3');
    expect(store.getDueMissions()).toHaveLength(0);
    store.resetFailures(m.id);
    // Después de reset, no será due hasta que pase el segundo del interval.
    // Como acabamos de recordRun, `last_run_at` está en el momento actual.
    // Esperamos brevemente y comprobamos.
  });
});

describe('MissionsStore — coexistencia legacy + nuevo', () => {
  it('una misión legacy y una nueva conviven', () => {
    store.create({ name: 'old', prompt: 'p', cron_seconds: 60 });
    store.create({ name: 'new', prompt: 'p', cron_seconds: 0, trigger: { kind: 'interval', seconds: 30 } });
    const list = store.list();
    expect(list).toHaveLength(2);
    const old = list.find(m => m.name === 'old')!;
    const nu = list.find(m => m.name === 'new')!;
    expect(old.trigger_json).toBeNull();
    expect(nu.trigger_json).not.toBeNull();
    expect(store.getDueMissions()).toHaveLength(2);
  });
});
