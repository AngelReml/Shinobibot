import { describe, it, expect } from 'vitest';
import { isDue, parseCronExpr, parseTrigger, type MissionTrigger } from '../mission_scheduler.js';

function at(iso: string): Date {
  return new Date(iso);
}

describe('parseCronExpr', () => {
  it('acepta 5 campos válidos', () => {
    const e = parseCronExpr('0 9 * * 1');
    expect(e.minute).toEqual({ kind: 'list', values: [0] });
    expect(e.hour).toEqual({ kind: 'list', values: [9] });
    expect(e.day).toEqual({ kind: 'any' });
    expect(e.month).toEqual({ kind: 'any' });
    expect(e.weekday).toEqual({ kind: 'list', values: [1] });
  });
  it('soporta listas', () => {
    const e = parseCronExpr('0,15,30,45 * * * *');
    expect(e.minute).toEqual({ kind: 'list', values: [0, 15, 30, 45] });
  });
  it('rechaza menos de 5 campos', () => {
    expect(() => parseCronExpr('0 9 *')).toThrow();
  });
  it('rechaza rangos y pasos (no soportados)', () => {
    expect(() => parseCronExpr('*/5 * * * *')).toThrow();
    expect(() => parseCronExpr('1-5 * * * *')).toThrow();
  });
  it('rechaza valores fuera de rango', () => {
    expect(() => parseCronExpr('60 * * * *')).toThrow();
    expect(() => parseCronExpr('* 25 * * *')).toThrow();
  });
});

describe('isDue — interval', () => {
  const trigger: MissionTrigger = { kind: 'interval', seconds: 60 };
  it('sin lastRunAt → due', () => {
    expect(isDue(trigger, null, at('2026-05-14T10:00:00Z'))).toBe(true);
  });
  it('< seconds → no due', () => {
    expect(isDue(trigger, '2026-05-14T10:00:00Z', at('2026-05-14T10:00:30Z'))).toBe(false);
  });
  it('>= seconds → due', () => {
    expect(isDue(trigger, '2026-05-14T10:00:00Z', at('2026-05-14T10:01:00Z'))).toBe(true);
    expect(isDue(trigger, '2026-05-14T10:00:00Z', at('2026-05-14T10:02:00Z'))).toBe(true);
  });
});

describe('isDue — daily', () => {
  const trigger: MissionTrigger = { kind: 'daily', at: '09:00' };
  it('antes de la hora → no due', () => {
    const now = new Date('2026-05-14T08:30:00');
    expect(isDue(trigger, null, now)).toBe(false);
  });
  it('a/después de la hora sin run previo → due', () => {
    const now = new Date('2026-05-14T09:30:00');
    expect(isDue(trigger, null, now)).toBe(true);
  });
  it('ya corrió hoy en la ventana → no due', () => {
    const now = new Date('2026-05-14T15:00:00');
    expect(isDue(trigger, '2026-05-14T09:05:00', now)).toBe(false);
  });
  it('último run fue ayer → due hoy a la hora', () => {
    const now = new Date('2026-05-15T09:30:00');
    expect(isDue(trigger, '2026-05-14T09:05:00', now)).toBe(true);
  });
});

describe('isDue — weekly', () => {
  // 2026-05-14 es jueves (thu).
  it('día equivocado → no due', () => {
    const t: MissionTrigger = { kind: 'weekly', day: 'mon', at: '09:00' };
    const now = new Date('2026-05-14T09:30:00'); // jueves
    expect(isDue(t, null, now)).toBe(false);
  });
  it('día correcto, hora correcta → due', () => {
    const t: MissionTrigger = { kind: 'weekly', day: 'thu', at: '09:00' };
    const now = new Date('2026-05-14T10:00:00'); // jueves
    expect(isDue(t, null, now)).toBe(true);
  });
  it('día correcto, ya corrió hoy → no due', () => {
    const t: MissionTrigger = { kind: 'weekly', day: 'thu', at: '09:00' };
    const now = new Date('2026-05-14T15:00:00');
    expect(isDue(t, '2026-05-14T09:05:00', now)).toBe(false);
  });
});

describe('isDue — cron', () => {
  it('matchea el minuto exacto', () => {
    const t: MissionTrigger = { kind: 'cron', expr: parseCronExpr('0 9 * * *') };
    const now = new Date('2026-05-14T09:00:30'); // 9:00 local
    expect(isDue(t, null, now)).toBe(true);
  });
  it('no matchea minutos fuera', () => {
    const t: MissionTrigger = { kind: 'cron', expr: parseCronExpr('0 9 * * *') };
    const now = new Date('2026-05-14T09:01:00');
    expect(isDue(t, null, now)).toBe(false);
  });
  it('no vuelve a disparar en el mismo minuto', () => {
    const t: MissionTrigger = { kind: 'cron', expr: parseCronExpr('* * * * *') };
    const now = new Date('2026-05-14T10:00:30');
    expect(isDue(t, '2026-05-14T10:00:05', now)).toBe(false);
  });
  it('dispara en el siguiente minuto', () => {
    const t: MissionTrigger = { kind: 'cron', expr: parseCronExpr('* * * * *') };
    const now = new Date('2026-05-14T10:01:00');
    expect(isDue(t, '2026-05-14T10:00:05', now)).toBe(true);
  });
  it('weekday 7 = domingo (ISO compat)', () => {
    const t: MissionTrigger = { kind: 'cron', expr: parseCronExpr('0 9 * * 7') };
    const sun = new Date('2026-05-17T09:00:30'); // 2026-05-17 = domingo
    expect(isDue(t, null, sun)).toBe(true);
  });
});

describe('parseTrigger', () => {
  it('interval válido', () => {
    expect(parseTrigger({ kind: 'interval', seconds: 30 }))
      .toEqual({ kind: 'interval', seconds: 30 });
  });
  it('daily válido', () => {
    expect(parseTrigger({ kind: 'daily', at: '09:00' }))
      .toEqual({ kind: 'daily', at: '09:00' });
  });
  it('weekly válido', () => {
    const r = parseTrigger({ kind: 'weekly', day: 'mon', at: '09:00' });
    expect(r).toEqual({ kind: 'weekly', day: 'mon', at: '09:00' });
  });
  it('cron válido devuelve expr parseada', () => {
    const r = parseTrigger({ kind: 'cron', expr: '0 9 * * 1' }) as any;
    expect(r.kind).toBe('cron');
    expect(r.expr.hour).toEqual({ kind: 'list', values: [9] });
  });
  it('rechaza objetos malformados', () => {
    expect(() => parseTrigger(null)).toThrow();
    expect(() => parseTrigger({})).toThrow();
    expect(() => parseTrigger({ kind: 'interval', seconds: -1 })).toThrow();
    expect(() => parseTrigger({ kind: 'daily' })).toThrow();
    expect(() => parseTrigger({ kind: 'weekly', day: 'xyz', at: '09:00' })).toThrow();
    expect(() => parseTrigger({ kind: 'unknown' })).toThrow();
  });
  it('rechaza HH:MM fuera de rango', () => {
    expect(() => parseTrigger({ kind: 'daily', at: '25:00' })).toThrow();
    expect(() => parseTrigger({ kind: 'daily', at: '09:99' })).toThrow();
    expect(() => parseTrigger({ kind: 'daily', at: 'foo' })).toThrow();
  });
});
