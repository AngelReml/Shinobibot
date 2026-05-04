// A5 — Continuous watcher for the upstream Hermes repo.
//
// Polls https://api.github.com/repos/NousResearch/hermes-agent/releases at most
// every `intervalMs` (default 24h). On a new tag, persists a notice that the
// CLI surfaces on next start. The CLI proposes `shinobi import hermes` so the
// user can pull the new manifests / skills.
//
// State lives at %APPDATA%/Shinobi/hermes_watcher.json:
//   {
//     "last_seen_tag": "v1.4.0",
//     "last_check_iso": "2026-05-04T...",
//     "pending_notice": null | { tag, published_at, body, html_url, fetched_at }
//   }
//
// The watcher is intentionally side-effect light: it never imports skills
// itself; it only tells the user there is something new.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = process.env.HERMES_WATCH_REPO ?? 'NousResearch/hermes-agent';
const SHINOBI_DIR = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Shinobi');
const STATE_FILE = path.join(SHINOBI_DIR, 'hermes_watcher.json');
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface HermesNotice {
  tag: string;
  published_at: string;
  html_url: string;
  body: string;
  asset_names: string[];
  fetched_at: string;
}

export interface WatcherState {
  last_seen_tag: string | null;
  last_check_iso: string | null;
  pending_notice: HermesNotice | null;
}

export interface WatcherOptions {
  /** Override target repo (e.g. for tests). */
  repo?: string;
  /** Override the state file path (e.g. for tests). */
  stateFile?: string;
  /** Override fetcher — used by tests to avoid hitting GitHub. */
  fetchReleases?: () => Promise<GhRelease[]>;
}

export interface GhRelease {
  tag_name: string;
  name?: string;
  published_at?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name: string }>;
}

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

export function loadState(stateFile = STATE_FILE): WatcherState {
  if (!fs.existsSync(stateFile)) return { last_seen_tag: null, last_check_iso: null, pending_notice: null };
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as WatcherState;
  } catch {
    return { last_seen_tag: null, last_check_iso: null, pending_notice: null };
  }
}

export function saveState(state: WatcherState, stateFile = STATE_FILE): void {
  ensureDir(path.dirname(stateFile));
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

async function defaultFetchReleases(repo: string): Promise<GhRelease[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=10`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'shinobi-hermes-watcher/1.0',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('GitHub API did not return an array');
  return data as GhRelease[];
}

/** Single check. Returns the notice if a *new* (newer than last_seen_tag) release exists. */
export async function checkOnce(opts: WatcherOptions = {}): Promise<HermesNotice | null> {
  const repo = opts.repo ?? REPO;
  const stateFile = opts.stateFile ?? STATE_FILE;
  const state = loadState(stateFile);
  const now = new Date().toISOString();
  let releases: GhRelease[];
  try {
    releases = await (opts.fetchReleases ?? (() => defaultFetchReleases(repo)))();
  } catch (e) {
    state.last_check_iso = now;
    saveState(state, stateFile);
    throw e;
  }
  // Pick the newest non-draft, non-prerelease release.
  const stable = releases.find((r) => !r.draft && !r.prerelease);
  if (!stable) {
    state.last_check_iso = now;
    saveState(state, stateFile);
    return null;
  }
  if (stable.tag_name === state.last_seen_tag) {
    state.last_check_iso = now;
    saveState(state, stateFile);
    return null;
  }
  // New tag.
  const notice: HermesNotice = {
    tag: stable.tag_name,
    published_at: stable.published_at ?? '',
    html_url: stable.html_url ?? `https://github.com/${repo}/releases/tag/${stable.tag_name}`,
    body: (stable.body ?? '').slice(0, 4000),
    asset_names: (stable.assets ?? []).map((a) => a.name),
    fetched_at: now,
  };
  state.last_seen_tag = stable.tag_name;
  state.last_check_iso = now;
  state.pending_notice = notice;
  saveState(state, stateFile);
  return notice;
}

/** Consume the pending notice (clears the state). */
export function popPendingNotice(stateFile = STATE_FILE): HermesNotice | null {
  const state = loadState(stateFile);
  const notice = state.pending_notice;
  if (notice) {
    state.pending_notice = null;
    saveState(state, stateFile);
  }
  return notice;
}

/** Format the notice for the CLI. */
export function renderNotice(notice: HermesNotice): string {
  const skillCount = notice.asset_names.filter((n) => /skill/i.test(n) || n.endsWith('.zip')).length;
  return [
    '',
    '╭─ Hermes upstream — new release detected ──────────────────',
    `│ tag         : ${notice.tag}`,
    `│ published   : ${notice.published_at || '(unknown)'}`,
    `│ assets      : ${notice.asset_names.length} (${skillCount} look like skills)`,
    `│ release     : ${notice.html_url}`,
    '│',
    '│ Suggested next step:',
    '│   shinobi import hermes --hermes-root <local clone> --dry-run',
    '│',
    '│ Then re-run with --overwrite to apply (with backups).',
    '╰──────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}

/** Long-running watcher: starts a 24h interval. Returns a stop() handle. */
export function startWatcher(opts: WatcherOptions & { intervalMs?: number } = {}): { stop: () => void } {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const notice = await checkOnce(opts);
      if (notice) console.log(renderNotice(notice));
    } catch (e) {
      console.warn(`[hermes-watcher] check failed: ${(e as Error).message}`);
    }
  };
  // First check shortly after start so the user gets feedback in dev sessions.
  const t1 = setTimeout(tick, 5_000);
  const t2 = setInterval(tick, interval);
  // Don't keep the process alive just for the watcher.
  if (typeof t1.unref === 'function') t1.unref();
  if (typeof t2.unref === 'function') t2.unref();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(t1);
      clearInterval(t2);
    },
  };
}
