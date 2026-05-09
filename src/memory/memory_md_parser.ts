// src/memory/memory_md_parser.ts
//
// Bloque 4 — parser/serializer minimal de USER.md / MEMORY.md.
//
// Formato (Hermes §-style con extensión opcional para nombrar secciones):
//
//   # Section name              ← H1 opcional como primera línea del bloque
//   contenido del bloque        ← multi-línea
//   más contenido
//
//   §
//
//   # Otra sección
//   contenido
//
// Reglas:
//   - Delimitador entre secciones: línea con `§` rodeada de saltos de línea
//     (`\n§\n`). Coincide con Hermes — permite que `§` aparezca como texto
//     dentro de un bloque sin partirlo.
//   - Si el primer renglón del bloque es `# <nombre>`, esa sección se
//     identifica por nombre (case-insensitive). Si no, queda anónima
//     (entry-style Hermes).
//   - El parser devuelve `Section[]` preservando el orden original.

export interface Section {
  /** First-line H1 name (case-insensitive identifier). `null` if anonymous. */
  name: string | null;
  /** Body lines after the H1 (or full block if anonymous). */
  body: string;
}

const ENTRY_DELIMITER = '\n§\n';

export function parseSections(text: string): Section[] {
  const trimmed = (text || '').replace(/^﻿/, '').trim();
  if (!trimmed) return [];

  // Split on `\n§\n`, then trim and discard empty fragments.
  const blocks = trimmed.split(ENTRY_DELIMITER).map(b => b.trim()).filter(b => b.length > 0);

  return blocks.map(block => {
    const lines = block.split(/\r?\n/);
    const first = lines[0];
    const m = first.match(/^#\s+(.+?)\s*$/);
    if (m) {
      return { name: m[1].trim(), body: lines.slice(1).join('\n').trim() };
    }
    return { name: null, body: block };
  });
}

export function serializeSections(sections: Section[]): string {
  if (sections.length === 0) return '';
  const blocks = sections.map(s => {
    if (s.name) {
      const body = s.body.trim();
      return body ? `# ${s.name}\n${body}` : `# ${s.name}`;
    }
    return s.body.trim();
  });
  return blocks.join(ENTRY_DELIMITER) + '\n';
}

/** Case-insensitive section lookup by name. Returns the index, or -1 if not found. */
export function findSectionByName(sections: Section[], name: string): number {
  const target = name.trim().toLowerCase();
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (s.name && s.name.trim().toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * Replace the body (or insert if missing) of the section identified by `name`.
 * Returns a new array, original is not mutated.
 */
export function replaceSection(sections: Section[], name: string, newBody: string): Section[] {
  const idx = findSectionByName(sections, name);
  const out = sections.slice();
  if (idx >= 0) {
    out[idx] = { name: out[idx].name, body: newBody.trim() };
  } else {
    out.push({ name: name.trim(), body: newBody.trim() });
  }
  return out;
}

/** Total char count of the file as it would be serialised. Used for limits. */
export function totalChars(sections: Section[]): number {
  return serializeSections(sections).length;
}

/** Append a new anonymous section (entry-style). Used by env append/propose. */
export function appendAnonymous(sections: Section[], body: string): Section[] {
  return [...sections, { name: null, body: body.trim() }];
}
