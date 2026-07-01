/**
 * kagemusha/ingest/transcripts.ts — the thin wrapper (dossier §6.2).
 *
 * Downloading transcripts is NOT a subsystem; it's a command. Responsibility:
 * invoke `yt-dlp` as a subprocess, then import the resulting .srt/.vtt to the
 * corpus with provenance USER_DIRECT (the user chose the channel). No manifest,
 * no CSV, no sandbox: it's a read into a local folder, risk is nil. The approval
 * gate allows it without a pause (it doesn't touch .env/.ssh/secrets/payment).
 *
 * SEC-F4.2 (2026-07-01): `opts.channel` used to be interpolated directly into a
 * shell string ("`${channelUrl(opts.channel)}`" inside a joined command run via
 * a shell). A channel value like `foo; rm -rf ~` or `$(...)` would execute
 * arbitrary shell code the moment this path is invoked. Fixed by (1) validating
 * `opts.channel` against a strict allowlist BEFORE any command is built, and (2)
 * invoking yt-dlp via `execFile` with a discrete argv array and NO shell —
 * `opts.channel` (or the URL derived from it) is passed as one inert argv
 * element, never interpolated into a string that a shell parses.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseSubtitles, estimateTokens } from './srt_parser.js';
import type { Channel, Transcript, Provenance } from '../types.js';
import { KagemushaStore } from '../store/store.js';

export interface IngestOptions {
  channel: string;            // handle or URL
  langs?: string[];           // default ["es","en"]
  max?: number;               // --playlist-end
  outDir: string;
}

/**
 * SEC-F4.2 — strict allowlist for a YouTube channel identifier. Accepts:
 *   - a bare handle (with or without leading "@"): letters/digits/._- , 1-100 chars
 *   - a legacy channel id: "UC" followed by 22 URL-safe base64 chars
 *   - a full https://www.youtube.com/... or https://youtu.be/... URL (no other host)
 * Anything else (shell metacharacters, `;`, `$(`, backticks, spaces, other hosts,
 * etc.) is rejected BEFORE any command is built. This is the primary defense;
 * execFile (no shell) is the secondary one.
 */
const HANDLE_RE = /^@?[A-Za-z0-9_.-]{1,100}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const YT_URL_RE = /^https:\/\/(www\.youtube\.com|youtu\.be|m\.youtube\.com)\/[A-Za-z0-9_.\-\/@?=&%]{1,300}$/;

export class InvalidChannelError extends Error {
  constructor(value: string) {
    super(`kagemusha: opts.channel rejected by validator (not a valid YouTube handle/id/URL): ${JSON.stringify(value)}`);
    this.name = 'InvalidChannelError';
  }
}

/** Validate a channel identifier. Throws InvalidChannelError if it doesn't match the allowlist. */
export function assertValidChannel(channel: string): void {
  if (typeof channel !== 'string' || channel.length === 0) throw new InvalidChannelError(String(channel));
  if (HANDLE_RE.test(channel) || CHANNEL_ID_RE.test(channel) || YT_URL_RE.test(channel)) return;
  throw new InvalidChannelError(channel);
}

function channelUrl(handle: string): string {
  if (/^https:\/\//.test(handle)) return handle;
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  return `https://www.youtube.com/${h}/videos`;
}

/** Run yt-dlp via execFile (no shell) with a discrete argv array. */
function runYtDlp(args: string[], timeoutMs: number): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    execFile('yt-dlp', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, output: String(stdout ?? ''), error: `${err.message}${stderr ? `\n${stderr}` : ''}` });
        return;
      }
      resolve({ success: true, output: String(stdout ?? '') });
    });
  });
}

/** Build + run the yt-dlp command (dossier §6.1). Returns the subtitle files found. */
export async function downloadChannelTranscripts(opts: IngestOptions): Promise<{ files: string[]; ranSuccessfully: boolean; error?: string }> {
  // SEC-F4.2: reject before building anything — never let an unvalidated value
  // reach argv construction, let alone a shell string.
  assertValidChannel(opts.channel);

  const langs = (opts.langs ?? ['es', 'en']).join(',');
  fs.mkdirSync(opts.outDir, { recursive: true });
  const outTmpl = path.join(opts.outDir, '%(channel)s/%(upload_date)s-%(id)s-%(title).80s.%(ext)s');

  const args = [
    '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', `${langs},${langs}-orig`,
    '--sub-format', 'vtt', '--convert-subs', 'srt',
  ];
  if (opts.max) args.push('--playlist-end', String(opts.max));
  args.push('--output', outTmpl, channelUrl(opts.channel));

  const r = await runYtDlp(args, 600_000);
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
