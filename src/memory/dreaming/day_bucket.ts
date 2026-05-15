/**
 * DayBucket — agrupa MemoryMessages por día UTC para que el Dreaming
 * engine procese cada jornada de uso por separado.
 *
 * Una "day bucket" abarca [00:00 UTC, 24:00 UTC) de una fecha
 * YYYY-MM-DD.
 *
 * Ejemplo de uso:
 *   const buckets = bucketByDay(messages);
 *   for (const [date, msgs] of buckets) { ... }
 */

import type { MemoryMessage } from '../providers/types.js';

/** Devuelve YYYY-MM-DD UTC del timestamp ISO. */
export function dayKey(isoTs: string | undefined | null): string {
  if (!isoTs) return 'unknown';
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

/**
 * Particiona mensajes por día. Devuelve un Map ordenado por fecha asc
 * para que el dreaming procese del más viejo al más nuevo.
 */
export function bucketByDay(messages: MemoryMessage[]): Map<string, MemoryMessage[]> {
  const map = new Map<string, MemoryMessage[]>();
  for (const m of messages) {
    const key = dayKey(m.ts);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  // Orden cronológico ascendente.
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Helper: keys ordenadas. */
export function dayKeysAsc(messages: MemoryMessage[]): string[] {
  return [...new Set(messages.map(m => dayKey(m.ts)))].sort();
}
