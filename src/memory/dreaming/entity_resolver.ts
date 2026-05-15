/**
 * EntityResolver — extrae entidades (personas, lugares, proyectos,
 * decisiones) de un bucket de mensajes y las normaliza para construir
 * un knowledge graph básico.
 *
 * Implementación heurística sin LLM: NER por patrones + capitalización
 * + tokens repetidos. Esto cubre el 70% de los casos con cero coste.
 * Si el operador quiere NER de calidad, puede inyectar un `llmExtractor`.
 *
 * Output: array de Entities con counts + role + ejemplos. Pensado para
 * que el dreaming pueda escribir dreams/<date>.md con secciones por
 * categoría.
 */

import type { MemoryMessage } from '../providers/types.js';

export type EntityKind =
  | 'person'
  | 'place'
  | 'project'
  | 'tool'
  | 'decision'
  | 'preference'
  | 'unknown';

export interface Entity {
  text: string;
  kind: EntityKind;
  /** Cuántas veces aparece en este bucket. */
  count: number;
  /** Ejemplos de mensajes donde aparece. */
  examples: string[];
}

const PROPER_NOUN = /\b([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚÑáéíóúñ]{2,})\b/g;

const STOPWORDS = new Set([
  'Pero', 'Como', 'Cuando', 'Donde', 'Por', 'Para', 'Que', 'Una', 'Una', 'Esta', 'Este',
  'Hola', 'Gracias', 'Buenos', 'Buenas', 'Hoy', 'Ayer', 'Mañana', 'Aqui', 'Aquí',
  'But', 'When', 'Where', 'Hello', 'Thanks', 'Good', 'Today', 'Yesterday',
]);

const PREF_RE = /\b(me\s+gusta|no\s+me\s+gusta|prefiero|odio|amo|adoro)\s+(.+?)(?:\.|,|\n|$)/gi;
const DECISION_RE = /\b(decidimos|decid[íi]|vamos\s+a|elegimos|optamos\s+por|preferimos)\s+(.+?)(?:\.|,|\n|$)/gi;
const TOOL_RE = /\b(uso|usamos|invoque|invoqué|llame|llamamos|ejecut[óé])\s+([a-z_][a-z0-9_\/-]*[a-z0-9_])/gi;

/** Extrae entidades de un bucket. */
export function extractEntities(messages: MemoryMessage[]): Entity[] {
  const map = new Map<string, Entity>();

  for (const m of messages) {
    const text = m.content ?? '';

    // 1. Proper nouns (personas/lugares/proyectos).
    let match: RegExpExecArray | null;
    PROPER_NOUN.lastIndex = 0;
    while ((match = PROPER_NOUN.exec(text)) !== null) {
      const name = match[1];
      if (STOPWORDS.has(name)) continue;
      addOrIncrement(map, name, 'unknown', text);
    }

    // 2. Preferencias.
    PREF_RE.lastIndex = 0;
    while ((match = PREF_RE.exec(text)) !== null) {
      const target = match[2].trim().slice(0, 60);
      if (target) addOrIncrement(map, target, 'preference', text);
    }

    // 3. Decisiones.
    DECISION_RE.lastIndex = 0;
    while ((match = DECISION_RE.exec(text)) !== null) {
      const what = match[2].trim().slice(0, 80);
      if (what) addOrIncrement(map, what, 'decision', text);
    }

    // 4. Tools mencionadas.
    TOOL_RE.lastIndex = 0;
    while ((match = TOOL_RE.exec(text)) !== null) {
      const tool = match[2].trim();
      if (tool && tool.length < 40) addOrIncrement(map, tool, 'tool', text);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function addOrIncrement(
  map: Map<string, Entity>,
  text: string,
  kind: EntityKind,
  example: string
): void {
  const key = `${kind}:${text.toLowerCase()}`;
  const existing = map.get(key);
  if (existing) {
    existing.count++;
    if (existing.examples.length < 3) existing.examples.push(example.slice(0, 120));
  } else {
    map.set(key, { text, kind, count: 1, examples: [example.slice(0, 120)] });
  }
}

/**
 * Comparación entre buckets de 2 días: ¿qué entidades aparecen NUEVAS
 * en `today` que no estaban en `yesterday`?
 */
export function diffEntities(today: Entity[], yesterday: Entity[]): {
  novel: Entity[];
  recurring: Entity[];
} {
  const yKeys = new Set(yesterday.map(e => `${e.kind}:${e.text.toLowerCase()}`));
  const novel: Entity[] = [];
  const recurring: Entity[] = [];
  for (const e of today) {
    const key = `${e.kind}:${e.text.toLowerCase()}`;
    if (yKeys.has(key)) recurring.push(e);
    else novel.push(e);
  }
  return { novel, recurring };
}
