/**
 * kagemusha/analysis/chunker.ts — split a transcript into overlapping windows
 * that respect sentence boundaries (dossier §7.2 / D1). Pure.
 *
 * Embeddings reuse the existing EmbeddingProvider (src/memory) — Kagemusha does
 * NOT add a second embedding stack.
 */

export interface TextChunk { idx: number; text: string; char_start: number; char_end: number; }

const SENT_END = /[.!?。！？]\s/g;

export function chunkText(text: string, opts: { windowChars?: number; overlapChars?: number } = {}): TextChunk[] {
  const win = opts.windowChars ?? 1200;
  const overlap = Math.min(opts.overlapChars ?? 200, win - 1);
  const chunks: TextChunk[] = [];
  if (!text.trim()) return chunks;

  let start = 0;
  let idx = 0;
  while (start < text.length) {
    let end = Math.min(start + win, text.length);
    // Extend/retract to the nearest sentence boundary near `end` (within overlap).
    if (end < text.length) {
      const slice = text.slice(start, Math.min(end + overlap, text.length));
      SENT_END.lastIndex = 0;
      let lastBoundary = -1; let m: RegExpExecArray | null;
      while ((m = SENT_END.exec(slice))) {
        const abs = start + m.index + 1;
        if (abs <= end + overlap && abs > start + win * 0.5) lastBoundary = abs;
      }
      if (lastBoundary > start) end = lastBoundary;
    }
    chunks.push({ idx, text: text.slice(start, end).trim(), char_start: start, char_end: end });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
    idx++;
  }
  return chunks;
}
