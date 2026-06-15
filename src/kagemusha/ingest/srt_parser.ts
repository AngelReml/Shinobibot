/**
 * kagemusha/ingest/srt_parser.ts — normalize .srt/.vtt subtitles to clean text.
 *
 * Pure (no I/O). Strips timestamps/cue markers, deduplicates the rolling repeated
 * lines that auto-subs produce, and joins into paragraphs. Lo sencillo, sencillo.
 */

const TIMESTAMP = /^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}/;
const VTT_TAG = /<[^>]+>/g;            // <c>, <00:00:00.000>, etc.
const CUE_INDEX = /^\d+$/;

/** Parse subtitle text (srt or vtt) → normalized prose. */
export function parseSubtitles(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let prev = '';
  for (let line of lines) {
    line = line.replace(VTT_TAG, '').trim();
    if (!line) continue;
    if (line === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (TIMESTAMP.test(line)) continue;
    if (CUE_INDEX.test(line)) continue;
    if (line.includes('align:') || line.includes('position:')) continue;
    // Auto-subs repeat the previous line as it scrolls — drop consecutive dups
    // and lines that are a prefix of the previous (rolling reveal).
    const norm = line.toLowerCase();
    if (norm === prev) continue;
    if (prev && prev.endsWith(norm)) continue;
    if (prev && norm.startsWith(prev) && norm.length > prev.length) {
      // rolling extension: replace prev with the longer line
      out[out.length - 1] = line;
      prev = norm;
      continue;
    }
    out.push(line);
    prev = norm;
  }
  // Join into paragraphs: merge lines into sentences, break on sentence-final.
  const joined = out.join(' ').replace(/\s+/g, ' ').trim();
  return joined;
}

/** Rough token estimate (≈ words / 0.75) — no tokenizer dependency. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}
