/**
 * Mission Scheduler — decide cuándo está "due" una misión recurrente.
 *
 * La store actual (`missions_recurrent`) soporta solo `cron_seconds`
 * (intervalo fijo). Este módulo añade triggers ricos sin tocar el schema:
 *
 *   - interval         → cada N segundos (compat con cron_seconds).
 *   - daily            → "todos los días a HH:MM".
 *   - weekly           → "los <día> a HH:MM" (mon..sun, ISO 1..7).
 *   - cron             → expresión clásica "m h d M w". Solo soporta "*",
 *                        números fijos y listas "1,15,30". No soporta
 *                        operadores de paso ni rangos, para mantener
 *                        parsing trivial y determinista.
 *
 * Parsing fail-fast: cualquier expresión malformada lanza Error con un
 * mensaje claro. Esto se valida al crear/editar la misión, no al hacer
 * tick — el ResidentLoop debe poder asumir que los triggers son válidos.
 *
 * Determinismo: `isDue(trigger, lastRunAt, now)` es pura. Útil tanto para
 * tests como para que el resident_loop la importe directamente.
 */

export type MissionTrigger =
  | { kind: 'interval'; seconds: number }
  | { kind: 'daily'; at: string } // 'HH:MM'
  | { kind: 'weekly'; day: WeekDay; at: string }
  | { kind: 'cron'; expr: CronExpr };

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CronExpr {
  minute: CronField; // 0..59
  hour: CronField;   // 0..23
  day: CronField;    // 1..31
  month: CronField;  // 1..12
  weekday: CronField; // 0..6 (Sun=0, ISO compat: también 7=Sun)
}

export type CronField =
  | { kind: 'any' }
  | { kind: 'list'; values: number[] };

const WEEKDAY_INDEX: Record<WeekDay, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseHHMM(s: string): { h: number; m: number } {
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`hora "${s}" debe ser HH:MM (24h)`);
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) throw new Error(`hora "${s}" fuera de rango`);
  return { h, m: mm };
}

function parseField(raw: string, min: number, max: number, label: string): CronField {
  if (raw === '*') return { kind: 'any' };
  if (!/^[\d,]+$/.test(raw)) throw new Error(`campo cron "${label}" no soportado: "${raw}" (solo *, número o "1,15")`);
  const values = raw.split(',').map(s => {
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`valor "${s}" fuera de rango para "${label}" (${min}..${max})`);
    }
    return n;
  });
  // Dedup + sort para representación canónica.
  return { kind: 'list', values: [...new Set(values)].sort((a, b) => a - b) };
}

export function parseCronExpr(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron "${expr}" debe tener 5 campos (m h d M w)`);
  }
  return {
    minute: parseField(parts[0], 0, 59, 'minute'),
    hour: parseField(parts[1], 0, 23, 'hour'),
    day: parseField(parts[2], 1, 31, 'day'),
    month: parseField(parts[3], 1, 12, 'month'),
    weekday: parseField(parts[4], 0, 7, 'weekday'),
  };
}

function fieldAllows(f: CronField, value: number): boolean {
  if (f.kind === 'any') return true;
  return f.values.includes(value);
}

function cronMatches(expr: CronExpr, d: Date): boolean {
  const minute = d.getMinutes();
  const hour = d.getHours();
  const day = d.getDate();
  const month = d.getMonth() + 1;
  let weekday = d.getDay(); // 0..6
  if (!fieldAllows(expr.minute, minute)) return false;
  if (!fieldAllows(expr.hour, hour)) return false;
  if (!fieldAllows(expr.day, day)) return false;
  if (!fieldAllows(expr.month, month)) return false;
  // Compat: 7 también significa domingo.
  if (!(fieldAllows(expr.weekday, weekday) || (weekday === 0 && fieldAllows(expr.weekday, 7)))) return false;
  return true;
}

/**
 * Punto de entrada principal. Devuelve true si la misión debe correr
 * AHORA según el trigger y el último run conocido.
 *
 * Reglas:
 *   - interval: due si !lastRun || now - lastRun >= seconds.
 *   - daily: due si hoy >= HH:MM y aún no se corrió hoy en esa ventana.
 *   - weekly: igual que daily, restringido al `day` ISO.
 *   - cron: due si la expresión matchea el minuto actual y no se corrió
 *     en este minuto.
 *
 * Nota: la granularidad mínima es de 1 minuto para daily/weekly/cron y
 * el resident_loop debe hacer tick con al menos esa frecuencia. Para
 * interval, soporta segundos.
 */
export function isDue(
  trigger: MissionTrigger,
  lastRunAt: string | null,
  now: Date = new Date(),
): boolean {
  const last = lastRunAt ? new Date(lastRunAt) : null;
  switch (trigger.kind) {
    case 'interval': {
      if (!last) return true;
      return now.getTime() - last.getTime() >= trigger.seconds * 1000;
    }
    case 'daily': {
      const { h, m } = parseHHMM(trigger.at);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (now < target) return false;
      if (!last) return true;
      // Due si la ventana cruzó el target desde el último run.
      return last < target;
    }
    case 'weekly': {
      const idx = WEEKDAY_INDEX[trigger.day];
      if (now.getDay() !== idx) return false;
      const { h, m } = parseHHMM(trigger.at);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (now < target) return false;
      if (!last) return true;
      return last < target;
    }
    case 'cron': {
      if (!cronMatches(trigger.expr, now)) return false;
      if (!last) return true;
      // No volver a disparar en el mismo minuto.
      const lastMinute = Math.floor(last.getTime() / 60_000);
      const nowMinute = Math.floor(now.getTime() / 60_000);
      return lastMinute < nowMinute;
    }
    default: {
      const _exhaustive: never = trigger;
      return false;
    }
  }
}

/**
 * Helper de conveniencia: parsea un trigger declarado como objeto plano
 * (típicamente leído de JSON en la DB) y devuelve un MissionTrigger
 * validado. Lanza si la forma es incorrecta.
 */
export function parseTrigger(input: unknown): MissionTrigger {
  if (!input || typeof input !== 'object') throw new Error('trigger no es objeto');
  const t = input as any;
  switch (t.kind) {
    case 'interval': {
      if (typeof t.seconds !== 'number' || !Number.isFinite(t.seconds) || t.seconds <= 0) {
        throw new Error('interval.seconds debe ser > 0');
      }
      return { kind: 'interval', seconds: Math.floor(t.seconds) };
    }
    case 'daily': {
      if (typeof t.at !== 'string') throw new Error('daily.at requerido');
      parseHHMM(t.at); // validate
      return { kind: 'daily', at: t.at };
    }
    case 'weekly': {
      if (!(t.day in WEEKDAY_INDEX)) throw new Error(`weekly.day inválido: "${t.day}"`);
      if (typeof t.at !== 'string') throw new Error('weekly.at requerido');
      parseHHMM(t.at);
      return { kind: 'weekly', day: t.day, at: t.at };
    }
    case 'cron': {
      if (typeof t.expr !== 'string') throw new Error('cron.expr requerido');
      // Aceptamos tanto string crudo "m h d M w" como un objeto ya parseado.
      const expr = parseCronExpr(t.expr);
      return { kind: 'cron', expr };
    }
    default:
      throw new Error(`trigger.kind "${t?.kind}" no soportado`);
  }
}
