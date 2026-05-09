// src/skills/skill_md_parser.ts
//
// Bloque 3 — parser/serializer minimal de SKILL.md (Hermes-style).
//
// Schema soportado en el frontmatter (single-level, sin nesting):
//   name              : string
//   description       : string
//   trigger_keywords  : string[]   (formato inline `[a, b, c]`)
//   model_recommended : string
//   created_at        : string (ISO8601)
//   status            : 'pending' | 'approved'
//   source            : 'auto' | 'user'
//   source_kind       : 'failure' | 'pattern' | 'manual'
//   source_hash       : string (sha256 truncado)
//   source_pattern_hash : string (sha256 truncado)
//   ...cualquier otra clave string → se preserva
//
// El cuerpo (body) tras el segundo `---` es markdown libre con instrucciones
// step-by-step para el LLM. No se interpreta — sólo se concatena al system
// message cuando la skill matchea (ver SkillManager.getContextSection).

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  trigger_keywords?: string[];
  model_recommended?: string;
  created_at?: string;
  status?: string;
  source?: string;
  source_kind?: string;
  source_hash?: string;
  source_pattern_hash?: string;
  [key: string]: string | string[] | undefined;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export function parseSkillMd(text: string): ParsedSkill {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: text };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) return { frontmatter: {}, body: text };

  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join('\n').trim();

  const frontmatter: SkillFrontmatter = {};
  for (const line of fmLines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z_0-9]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    frontmatter[key] = parseValue(rawValue.trim());
  }
  return { frontmatter, body };
}

function parseValue(v: string): string | string[] {
  if (!v) return '';
  // Inline array: [a, "b c", d]. Trim before stripping quotes so leading
  // whitespace from `, ` separators doesn't shield the quotes.
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineList(inner).map(s => s.trim()).map(stripQuotes).filter(s => s.length > 0);
  }
  return stripQuotes(v);
}

/**
 * Splits "a, b, \"c, d\"" into ["a", "b", "\"c, d\""] respecting quotes.
 * Avoids breaking on commas inside quoted strings.
 */
function splitInlineList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function serializeSkillMd(input: ParsedSkill): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(input.frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const items = value.map(v => quoteIfNeeded(String(v))).join(', ');
      lines.push(`${key}: [${items}]`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(String(value))}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(input.body || '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

function quoteIfNeeded(v: string): string {
  // Quote when the value contains characters that would confuse the parser:
  //   :  (key separator)
  //   ,  (list separator)
  //   [] (array delimiters)
  //   #  (comment-like)
  //   leading/trailing whitespace
  if (v === '') return '""';
  if (/[:,\[\]#]/.test(v) || /^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}
