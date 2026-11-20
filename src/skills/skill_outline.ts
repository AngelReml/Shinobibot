// src/skills/skill_outline.ts
//
// FICHA de una skill larga. Una skill de terceros puede pesar decenas de miles
// de caracteres (la de REA: ~48.000, unos 12.000 tokens) y casi todo es una
// tabla de "si te pasa X, haz Y" de la que una tarea usa dos o tres líneas.
// Cargarla entera cada vez es pagar el manual completo para consultar una
// página. Aquí se trocea SIN modelo (determinista: nada resumido ni inventado):
//
//   - secciones (`##`) y, dentro, trozos: cada viñeta o párrafo de primer nivel;
//   - cada trozo tiene un id estable ("2.7") y un titular (su arranque literal);
//   - la ficha enseña la introducción, las secciones cortas enteras y, de las
//     largas, solo el índice de titulares;
//   - el agente pide lo que necesita por id (`parts`) o por palabras (`find`).
//
// Todo el texto que se sirve es el original de la skill, literal.

export interface SkillChunk {
  id: string;
  /** Arranque literal del trozo, en una línea. */
  lead: string;
  text: string;
}

export interface SkillSection {
  /** Número de sección ("1", "2"…). "0" es lo que hay antes del primer `##`. */
  id: string;
  title: string;
  text: string;
  chunks: SkillChunk[];
}

/** Por debajo de este tamaño una skill se sirve entera, como siempre. */
export const SKILL_FULL_MAX_CHARS = 8_000;
/** Una sección de hasta este tamaño va entera en la ficha. */
export const FICHA_SECTION_INLINE_CHARS = 1_200;
/** Tope de la ficha. Si el índice no cabe, se acortan los titulares. */
export const FICHA_MAX_CHARS = 9_000;
/** Tope de lo que devuelve una búsqueda (`find`). */
export const FIND_MAX_CHARS = 6_000;

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** Titular de un trozo: su primera línea, literal (en una viñeta suele ser "caso: herramienta"). */
function leadOf(t: string): string {
  const first = t.split('\n').find((l) => l.trim() !== '' && !/^\s*(```|~~~)/.test(l)) ?? t;
  return oneLine(first.replace(/^(-|\*|\+|\d+[.)])\s+/, '').replace(/^#{3,6}\s+/, ''), 110);
}

/** Trocea el cuerpo de una sección en viñetas/párrafos de primer nivel, respetando bloques de código. */
function chunkSection(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => { const t = cur.join('\n').trim(); if (t) out.push(t); cur = []; };
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { cur.push(line); inFence = !inFence; continue; }
    if (inFence) { cur.push(line); continue; }
    const topBullet = /^(-|\*|\+|\d+[.)])\s+/.test(line);
    const subHeading = /^#{3,6}\s+/.test(line);
    if (topBullet || subHeading) { flush(); cur.push(line); continue; }
    if (line.trim() === '') {
      // Línea en blanco: cierra el trozo salvo que lo siguiente sea continuación sangrada (viñeta con varios párrafos).
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      if (next !== undefined && /^\s+\S/.test(next) && cur.length > 0) { cur.push(line); continue; }
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

/** Parte el cuerpo de una skill en secciones (`#`/`##`) y trozos. */
export function outlineSkill(body: string): SkillSection[] {
  const sections: { title: string; lines: string[] }[] = [{ title: '', lines: [] }];
  let inFence = false;
  for (const line of String(body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h && h[1].length === 2) { sections.push({ title: h[2], lines: [] }); continue; }
    sections[sections.length - 1].lines.push(line);
  }
  return sections
    .map((s, i) => {
      const text = s.lines.join('\n').trim();
      const id = String(i);
      return {
        id,
        title: s.title || 'Introducción',
        text,
        chunks: chunkSection(text).map((t, j) => ({ id: `${id}.${j + 1}`, lead: leadOf(t), text: t })),
      };
    })
    .filter((s) => s.text.length > 0);
}

/** ¿Merece ficha (es larga) o se sirve entera? */
export function needsFicha(body: string): boolean {
  return String(body ?? '').length > SKILL_FULL_MAX_CHARS;
}

/**
 * La ficha: introducción y secciones cortas enteras; de las largas, el índice
 * de titulares con su id. `how` explica al agente cómo pedir más.
 */
export function buildFicha(sections: SkillSection[], how: string): string {
  const render = (leadMax: number): string => {
    const out: string[] = [];
    for (const s of sections) {
      const head = s.id === '0' ? '' : `## [${s.id}] ${s.title}`;
      if (s.id === '0' || s.text.length <= FICHA_SECTION_INLINE_CHARS) {
        out.push([head, s.text].filter(Boolean).join('\n'));
        continue;
      }
      const index = s.chunks.map((c) => `  [${c.id}] ${oneLine(c.lead, leadMax)}${c.text.length > 1500 ? ` (${c.text.length} car.)` : ''}`);
      out.push(`${head}  — ${s.text.length} caracteres, ${s.chunks.length} trozos. ÍNDICE (no es el texto):\n${index.join('\n')}`);
    }
    return out.join('\n\n');
  };
  let body = render(110);
  for (const max of [80, 56, 40]) { if (body.length <= FICHA_MAX_CHARS) break; body = render(max); }
  return `${body}\n\n${how}`;
}

/** Devuelve las secciones o trozos pedidos por id ("2" = sección entera, "2.7" = un trozo). */
export function pickParts(sections: SkillSection[], ids: string[]): { text: string; missing: string[] } {
  const out: string[] = [];
  const missing: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim().replace(/^\[|\]$/g, '');
    if (!id) continue;
    const sec = sections.find((s) => s.id === id);
    if (sec) { out.push(`## [${sec.id}] ${sec.title}\n${sec.text}`); continue; }
    const owner = sections.find((s) => s.chunks.some((c) => c.id === id));
    const chunk = owner?.chunks.find((c) => c.id === id);
    if (owner && chunk) out.push(`[${chunk.id}] (${owner.title})\n${chunk.text}`);
    else missing.push(id);
  }
  return { text: out.join('\n\n'), missing };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'una', 'uno', 'los', 'las', 'del', 'que', 'con', 'por', 'para', 'como', 'from', 'this', 'that']);

/** Trozos que contienen las palabras buscadas, de más a menos coincidencias, hasta el tope. */
export function findInSkill(sections: SkillSection[], query: string, maxChars = FIND_MAX_CHARS): { text: string; hits: number; shown: number } {
  const words = [...new Set(String(query ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9_.-]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
  if (words.length === 0) return { text: '', hits: 0, shown: 0 };
  const scored: { c: SkillChunk; title: string; score: number }[] = [];
  for (const s of sections) {
    for (const c of s.chunks) {
      const hay = c.text.toLowerCase();
      const lead = c.lead.toLowerCase();
      let score = 0;
      for (const w of words) { if (hay.includes(w)) score += lead.includes(w) ? 3 : 1; }
      if (score > 0) scored.push({ c, title: s.title, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.c.text.length - b.c.text.length);
  const out: string[] = [];
  let used = 0;
  for (const h of scored) {
    const block = `[${h.c.id}] (${h.title})\n${h.c.text}`;
    if (used + block.length > maxChars) {
      if (out.length === 0) out.push(block.slice(0, maxChars) + `\n[trozo recortado: pídelo entero con parts=["${h.c.id}"]]`);
      break;
    }
    out.push(block); used += block.length;
  }
  return { text: out.join('\n\n'), hits: scored.length, shown: out.length };
}
