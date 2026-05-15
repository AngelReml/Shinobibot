/**
 * Carga config/sentinel/sources.yaml.
 *
 * Schema (lista de fuentes):
 *
 *   sources:
 *     - type: youtube_channel        # youtube_channel | github_repo | rss
 *       id: UCxxxxxxxxxxxxxxxxxxxxxx
 *       name: Canal de ejemplo
 *       interval: 1w                 # 1d | 3d | 1w
 *       whisper_threshold_minutes: 5
 *
 * Parser YAML mínimo propio — el schema es plano (lista de mapas con
 * valores escalares), no hace falta una dependencia completa de YAML.
 */

import { existsSync, readFileSync } from 'fs';
import type { SentinelSource, SourceType, CheckInterval } from './types.js';

const VALID_TYPES: ReadonlySet<string> = new Set(['youtube_channel', 'github_repo', 'rss']);
const VALID_INTERVALS: ReadonlySet<string> = new Set(['1d', '3d', '1w']);

export interface SourcesParseResult {
  sources: SentinelSource[];
  errors: string[];
}

/**
 * Parsea el contenido YAML. Tolera comentarios (#), líneas vacías, y
 * el patrón `- key: value` / `  key: value`. No soporta YAML anidado
 * complejo — no hace falta para este schema.
 */
export function parseSourcesYaml(text: string): SourcesParseResult {
  const errors: string[] = [];
  const sources: SentinelSource[] = [];
  let current: Record<string, string> | null = null;

  const flush = (): void => {
    if (!current) return;
    const v = validateSource(current);
    if (v.ok) sources.push(v.source);
    else errors.push(v.error);
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    // Quita comentarios fuera de comillas.
    const line = rawLine.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (!line.trim()) continue;
    if (/^sources\s*:/.test(line.trim())) continue;

    const itemStart = line.match(/^\s*-\s*(.*)$/);
    if (itemStart) {
      // Nuevo item de la lista.
      flush();
      current = {};
      const inline = itemStart[1].trim();
      if (inline) {
        const kv = parseKeyValue(inline);
        if (kv) current[kv.key] = kv.value;
      }
      continue;
    }

    // Línea key: value dentro del item actual.
    const kv = parseKeyValue(line.trim());
    if (kv && current) {
      current[kv.key] = kv.value;
    }
  }
  flush();

  return { sources, errors };
}

function parseKeyValue(s: string): { key: string; value: string } | null {
  const idx = s.indexOf(':');
  if (idx < 0) return null;
  const key = s.slice(0, idx).trim();
  let value = s.slice(idx + 1).trim();
  // Quita comillas envolventes.
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return key ? { key, value } : null;
}

function validateSource(
  raw: Record<string, string>
): { ok: true; source: SentinelSource } | { ok: false; error: string } {
  const type = raw.type;
  if (!VALID_TYPES.has(type)) {
    return { ok: false, error: `type inválido: "${type}" (debe ser youtube_channel|github_repo|rss)` };
  }
  if (!raw.id) return { ok: false, error: `fuente sin id (type=${type})` };
  const interval = raw.interval || '1w';
  if (!VALID_INTERVALS.has(interval)) {
    return { ok: false, error: `interval inválido: "${interval}" para ${raw.id}` };
  }
  const thr = Number(raw.whisper_threshold_minutes ?? '5');
  return {
    ok: true,
    source: {
      type: type as SourceType,
      id: raw.id,
      name: raw.name || raw.id,
      interval: interval as CheckInterval,
      whisper_threshold_minutes: Number.isFinite(thr) && thr >= 0 ? thr : 5,
    },
  };
}

/** Carga sources.yaml de disco. Devuelve lista vacía si no existe. */
export function loadSources(path: string): SourcesParseResult {
  if (!existsSync(path)) {
    return { sources: [], errors: [] };
  }
  try {
    return parseSourcesYaml(readFileSync(path, 'utf-8'));
  } catch (e: any) {
    return { sources: [], errors: [`no se pudo leer ${path}: ${e?.message ?? e}`] };
  }
}

/** Convierte interval a milisegundos. */
export function intervalToMs(interval: CheckInterval): number {
  const day = 24 * 60 * 60 * 1000;
  switch (interval) {
    case '1d': return day;
    case '3d': return 3 * day;
    case '1w': return 7 * day;
  }
}
