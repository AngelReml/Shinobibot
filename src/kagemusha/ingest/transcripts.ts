/**
 * kagemusha/ingest/transcripts.ts — the thin wrapper (dossier §6.2).
 *
 * Downloading transcripts is NOT a subsystem; it's a command. Responsibility:
 * invoke `yt-dlp` as a subprocess (via the existing run_command tool — no new
 * spawn lib), then import the resulting .srt/.vtt to the corpus with provenance
 * USER_DIRECT (the user chose the channel). No manifest, no CSV, no sandbox: it's
 * a read into a local folder, risk is nil. The approval gate allows it without a
 * pause (it doesn't touch .env/.ssh/secrets/payment).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parseSubtitles, estimateTokens } from './srt_parser.js';
import { kageSubprocess } from '../adapters.js';
import type { Channel, Transcript, Provenance } from '../types.js';
import { KagemushaStore } from '../store/store.js';

export interface IngestOptions {
  channel: string;            // handle or URL
  langs?: string[];           // default ["es","en"]
  max?: number;               // --playlist-end
  outDir: string;
}

function channelUrl(handle: string): string {
  if (/^https?:\/\//.test(handle)) return handle;
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  return `https://www.youtube.com/${h}/videos`;
}

/** Build + run the yt-dlp command (dossier §6.1). Returns the subtitle files found. */
export async function downloadChannelTranscripts(opts: IngestOptions): Promise<{ files: string[]; ranSuccessfully: boolean; error?: string }> {
  const langs = (opts.langs ?? ['es', 'en']).join(',');
  fs.mkdirSync(opts.outDir, { recursive: true });
  const outTmpl = path.join(opts.outDir, '%(channel)s/%(upload_date)s-%(id)s-%(title).80s.%(ext)s');
  const max = opts.max ? `--playlist-end ${opts.max}` : '';
  const cmd = [
    'yt-dlp', '--skip-download', '--write-subs', '--write-auto-subs',
    `--sub-langs "${langs},${langs}-orig"`, '--sub-format vtt', '--convert-subs srt',
    max, `--output "${outTmpl}"`, `"${channelUrl(opts.channel)}"`,
  ].filter(Boolean).join(' ');

  const r = await kageSubprocess(cmd, { timeout: 600_000 });
  const files = listSubtitleFiles(opts.outDir);
  return { files, ranSuccessfully: r.success, error: r.error };
}

/** Recursively collect .srt/.vtt files under a dir. */
export function listSubtitleFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(srt|vtt)$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Derive {video_id, lang, title} from a yt-dlp output filename. Best-effort. */
function parseFilename(file: string): { video_id: string; lang: string; title: string; published_at?: string } {
  const base = path.basename(file).replace(/\.(srt|vtt)$/i, '');
  // pattern: <upload_date>-<id>-<title>.<lang>  (lang is the last dotted segment)
  const langMatch = base.match(/\.([a-z]{2}(?:-[a-zA-Z]+)?)$/);
  const lang = langMatch ? langMatch[1] : 'unknown';
  const stem = langMatch ? base.slice(0, -langMatch[0].length) : base;
  const m = stem.match(/^(\d{8})-([A-Za-z0-9_-]{6,})-(.*)$/);
  if (m) return { published_at: isoFromYmd(m[1]), video_id: m[2], title: m[3], lang };
  return { video_id: crypto.createHash('sha1').update(stem).digest('hex').slice(0, 11), lang, title: stem };
}

function isoFromYmd(ymd: string): string | undefined {
  if (!/^\d{8}$/.test(ymd)) return undefined;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

export function transcriptId(videoId: string, lang: string): string {
  return crypto.createHash('sha256').update(`${videoId}|${lang}`).digest('hex').slice(0, 24);
}

/**
 * Import subtitle files to the corpus with provenance. Dedup by transcript_id;
 * re-importing the same folder does not duplicate rows (idempotent).
 */
export async function importToCorpus(files: string[], channel: Channel, store: KagemushaStore, sessionSeq = 0): Promise<{ imported: number; skipped: number }> {
  store.upsertChannel(channel);
  const now = new Date().toISOString();
  let imported = 0, skipped = 0;
  for (const file of files) {
    const meta = parseFilename(file);
    const raw = fs.readFileSync(file, 'utf-8');
    const text = parseSubtitles(raw);
    if (!text) { skipped++; continue; }
    const id = transcriptId(meta.video_id, meta.lang);
    const provenance: Provenance = {
      origin: 'USER_DIRECT', channel: 'youtube_transcript',
      source_url: `https://www.youtube.com/watch?v=${meta.video_id}`,
      retrieved_at: now, trust_tier: 2, session_seq: sessionSeq,
    };
    const t: Transcript = {
      transcript_id: id, video_id: meta.video_id, channel_id: channel.channel_id,
      title: meta.title, lang: meta.lang, published_at: meta.published_at,
      text, token_count: estimateTokens(text), provenance, ingested_at: now,
    };
    const isNew = store.upsertTranscript(t);
    if (isNew) imported++; else skipped++;
  }
  return { imported, skipped };
}
