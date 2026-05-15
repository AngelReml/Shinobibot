/**
 * Pieza 1 — Watcher pasivo.
 *
 * Para cada fuente: descarga la lista de items, filtra los ya vistos
 * (seen.json por fuente), y archiva los nuevos en
 * `data/sentinel/raw/<fecha>/<fuente>/<id>.md`. NO interpreta.
 *
 * Decisión de transcript:
 *   - durationMinutes > whisper_threshold_minutes  → 'whisper-local'
 *   - durationMinutes <= threshold                 → 'auto-caption'
 *   - sin duración (texto)                          → 'text'
 *
 * Fetch HTTP inyectable (`fetchImpl`) para tests deterministas.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  SentinelSource, SentinelItem, SeenState, SourceType,
} from './types.js';

export type FetchTextFn = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

/** Resuelve el transcript de un video largo. Inyectable; en tests, mock. */
export type TranscriptResolver = (item: SentinelItem, source: SentinelSource) => Promise<string>;

export interface WatcherOptions {
  /** Raíz de datos: data/sentinel/. */
  dataDir: string;
  fetchImpl?: FetchTextFn;
  /** Resolver de transcript para videos > threshold. */
  transcriptResolver?: TranscriptResolver;
  nowFn?: () => Date;
}

export interface WatchResult {
  sourceId: string;
  newItems: SentinelItem[];
  skipped: number;
  error?: string;
}

const ITEM_CAP = 25; // máx items a considerar por fuente y check.

export class SentinelWatcher {
  private dataDir: string;
  private fetchImpl: FetchTextFn;
  private transcriptResolver?: TranscriptResolver;
  private now: () => Date;

  constructor(opts: WatcherOptions) {
    this.dataDir = opts.dataDir;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.transcriptResolver = opts.transcriptResolver;
    this.now = opts.nowFn ?? (() => new Date());
  }

  private seenPath(sourceId: string): string {
    return join(this.dataDir, 'seen', slug(sourceId) + '.json');
  }

  private loadSeen(sourceId: string): SeenState {
    const p = this.seenPath(sourceId);
    if (existsSync(p)) {
      try {
        const s = JSON.parse(readFileSync(p, 'utf-8')) as SeenState;
        if (Array.isArray(s.seenItemIds)) return s;
      } catch { /* fall through */ }
    }
    return { sourceId, seenItemIds: [], lastCheckedAt: null };
  }

  private saveSeen(s: SeenState): void {
    const p = this.seenPath(s.sourceId);
    mkdirSync(join(this.dataDir, 'seen'), { recursive: true });
    writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8');
  }

  /** Chequea una fuente: descarga, filtra vistos, archiva nuevos. */
  async checkSource(source: SentinelSource): Promise<WatchResult> {
    const seen = this.loadSeen(source.id);
    const seenSet = new Set(seen.seenItemIds);
    let items: SentinelItem[];
    try {
      items = await this.fetchItems(source);
    } catch (e: any) {
      return { sourceId: source.id, newItems: [], skipped: 0, error: e?.message ?? String(e) };
    }

    const fresh = items.filter((it) => !seenSet.has(it.itemId));
    const archived: SentinelItem[] = [];
    for (const it of fresh) {
      const resolved = await this.resolveTranscript(it, source);
      this.archive(resolved);
      archived.push(resolved);
      seenSet.add(it.itemId);
    }

    this.saveSeen({
      sourceId: source.id,
      seenItemIds: [...seenSet],
      lastCheckedAt: this.now().toISOString(),
    });

    return {
      sourceId: source.id,
      newItems: archived,
      skipped: items.length - fresh.length,
    };
  }

  /** Decide y aplica el método de transcript. */
  private async resolveTranscript(item: SentinelItem, source: SentinelSource): Promise<SentinelItem> {
    if (item.durationMinutes === undefined) {
      return { ...item, transcriptSource: item.rawText ? 'text' : 'none' };
    }
    if (item.durationMinutes > source.whisper_threshold_minutes) {
      // Video largo → Whisper local.
      if (this.transcriptResolver) {
        const text = await this.transcriptResolver(item, source);
        return { ...item, rawText: text, transcriptSource: 'whisper-local' };
      }
      return { ...item, transcriptSource: 'whisper-local' };
    }
    // Video corto → auto-caption (el rawText ya trae la descripción/caption).
    return { ...item, transcriptSource: 'auto-caption' };
  }

  /** Archiva un item como markdown con front-matter. */
  private archive(item: SentinelItem): string {
    const date = item.archivedAt.slice(0, 10);
    const dir = join(this.dataDir, 'raw', date, slug(item.sourceId));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, slug(item.itemId) + '.md');
    const md = [
      '---',
      `itemId: ${item.itemId}`,
      `sourceId: ${item.sourceId}`,
      `sourceType: ${item.sourceType}`,
      `sourceName: ${item.sourceName}`,
      `title: ${JSON.stringify(item.title)}`,
      `url: ${item.url}`,
      `publishedAt: ${item.publishedAt}`,
      `durationMinutes: ${item.durationMinutes ?? ''}`,
      `transcriptSource: ${item.transcriptSource}`,
      `archivedAt: ${item.archivedAt}`,
      '---',
      '',
      item.rawText || '(sin contenido)',
      '',
    ].join('\n');
    writeFileSync(path, md, 'utf-8');
    return path;
  }

  /** Descarga + parsea items según el tipo de fuente. */
  async fetchItems(source: SentinelSource): Promise<SentinelItem[]> {
    switch (source.type) {
      case 'github_repo':    return this.fetchGithub(source);
      case 'rss':            return this.fetchRss(source);
      case 'youtube_channel': return this.fetchYoutube(source);
    }
  }

  private async fetchGithub(source: SentinelSource): Promise<SentinelItem[]> {
    const url = `https://api.github.com/repos/${source.id}/releases?per_page=${ITEM_CAP}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`github ${source.id} HTTP ${res.status}`);
    const arr = JSON.parse(res.text);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any): SentinelItem => ({
      itemId: String(r.id ?? r.tag_name),
      sourceId: source.id,
      sourceType: 'github_repo',
      sourceName: source.name,
      title: r.name || r.tag_name || '(release)',
      url: r.html_url ?? `https://github.com/${source.id}/releases`,
      publishedAt: r.published_at ?? r.created_at ?? this.now().toISOString(),
      rawText: r.body ?? '',
      transcriptSource: 'text',
      archivedAt: this.now().toISOString(),
    }));
  }

  private async fetchRss(source: SentinelSource): Promise<SentinelItem[]> {
    const res = await this.fetchImpl(source.id);
    if (!res.ok) throw new Error(`rss ${source.id} HTTP ${res.status}`);
    return parseFeed(res.text, source, this.now().toISOString()).slice(0, ITEM_CAP);
  }

  private async fetchYoutube(source: SentinelSource): Promise<SentinelItem[]> {
    // RSS público de YouTube — sin API key.
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(source.id)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`youtube ${source.id} HTTP ${res.status}`);
    return parseFeed(res.text, source, this.now().toISOString()).slice(0, ITEM_CAP);
  }
}

/** Parser mínimo de RSS 2.0 + Atom. Extrae item/entry. */
export function parseFeed(xml: string, source: SentinelSource, archivedAt: string): SentinelItem[] {
  const items: SentinelItem[] = [];
  const blocks = [
    ...matchAll(xml, /<item\b[\s\S]*?<\/item>/gi),
    ...matchAll(xml, /<entry\b[\s\S]*?<\/entry>/gi),
  ];
  for (const block of blocks) {
    const title = tag(block, 'title') || '(sin título)';
    // RSS: <guid>/<link>; Atom: <id>/<link href>.
    const id = tag(block, 'guid') || tag(block, 'id')
      || tag(block, 'yt:videoId') || tag(block, 'link') || title;
    const linkHref = block.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const link = linkHref || tag(block, 'link') || source.id;
    const published = tag(block, 'pubDate') || tag(block, 'published')
      || tag(block, 'updated') || archivedAt;
    const desc = tag(block, 'description') || tag(block, 'summary')
      || tag(block, 'content') || tag(block, 'media:description') || '';
    items.push({
      itemId: stripCdata(id).trim(),
      sourceId: source.id,
      sourceType: source.type,
      sourceName: source.name,
      title: stripCdata(title).trim(),
      url: stripCdata(link).trim(),
      publishedAt: toIso(stripCdata(published).trim(), archivedAt),
      rawText: stripCdata(desc).trim(),
      transcriptSource: 'text',
      archivedAt,
    });
  }
  return items;
}

// ── helpers ──

function defaultFetch(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  return fetch(url, { headers: { 'user-agent': 'shinobi-sentinel/1.0', accept: '*/*' } })
    .then(async (r) => ({ ok: r.ok, status: r.status, text: await r.text() }));
}

function matchAll(s: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name.replace(':', '\\:')}[^>]*>([\\s\\S]*?)<\\/${name.replace(':', '\\:')}>`, 'i');
  return block.match(re)?.[1] ?? null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function toIso(s: string, fallback: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

export function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}
