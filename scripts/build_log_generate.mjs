#!/usr/bin/env node
// Build the public build log from commits across the three repos that make
// up the Shinobi ecosystem: Shinobibot (this repo), OpenGravity (kernel),
// shinobi-bench (public benchmark). Emits two artefacts to web/:
//   - build-log.html  (the public page, dark theme inherited from styles.css)
//   - feed.xml        (RSS 2.0 feed of the same entries)
//
// Run locally:
//     node scripts/build_log_generate.mjs
// Or via the CI step before staging _site/ in pages.yml.
//
// Auth: optional GITHUB_TOKEN env var (passed by Actions automatically).
// Without auth the unauthenticated GitHub API quota (60/h) is plenty for
// 3 repos × 30 commits each.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_HTML = join(ROOT, 'web', 'build-log.html');
const OUT_RSS = join(ROOT, 'web', 'feed.xml');

const REPOS = [
  { full: 'AngelReml/Shinobibot', label: 'shinobibot', color: '#7c5cff' },
  { full: 'AngelReml/OpenGravity', label: 'opengravity', color: '#4ade80' },
  { full: 'AngelReml/shinobi-bench', label: 'shinobi-bench', color: '#f59e0b' },
];

const PER_REPO = Number(process.env.BUILD_LOG_PER_REPO ?? 30);
const TOTAL_LIMIT = Number(process.env.BUILD_LOG_TOTAL ?? 80);

async function ghJson(url) {
  const headers = {
    'User-Agent': 'shinobi-build-log/1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function fetchCommits(repo) {
  const list = await ghJson(`https://api.github.com/repos/${repo.full}/commits?per_page=${PER_REPO}`);
  // Pull file lists for the freshest few only — file detail blows up the request count.
  const detailed = await Promise.all(
    list.slice(0, Math.min(10, list.length)).map(async (c) => {
      try {
        const detail = await ghJson(`https://api.github.com/repos/${repo.full}/commits/${c.sha}`);
        return {
          ...c,
          files: (detail.files ?? []).slice(0, 12).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
        };
      } catch {
        return c;
      }
    }),
  );
  return [...detailed, ...list.slice(detailed.length)].map((c) => ({
    repo: repo.full,
    repo_label: repo.label,
    repo_color: repo.color,
    sha: c.sha,
    short: c.sha.slice(0, 7),
    message: c.commit?.message ?? '',
    author: c.commit?.author?.name ?? c.author?.login ?? 'unknown',
    date: c.commit?.author?.date ?? new Date().toISOString(),
    url: c.html_url,
    files: c.files ?? [],
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function renderHtml(entries, generatedAt) {
  const items = entries.map((e) => {
    const title = e.message.split('\n')[0].slice(0, 240);
    const body = e.message.split('\n').slice(1).join('\n').trim().slice(0, 1200);
    const filesHtml = e.files.length
      ? `<details class="files"><summary>${e.files.length} file${e.files.length === 1 ? '' : 's'}</summary><ul>${
          e.files.map((f) => `<li><code>${escapeHtml(f.filename)}</code> <span class="diff">+${f.additions}/−${f.deletions}</span></li>`).join('')
        }</ul></details>`
      : '';
    return `
      <article class="entry">
        <header>
          <span class="repo-pill" style="background:${e.repo_color};">${e.repo_label}</span>
          <a class="hash" href="${e.url}" target="_blank" rel="noopener">${e.short}</a>
          <time datetime="${e.date}">${new Date(e.date).toISOString().slice(0, 16).replace('T', ' ')}</time>
          <span class="author">${escapeHtml(e.author)}</span>
        </header>
        <h2>${escapeHtml(title)}</h2>
        ${body ? `<pre>${escapeHtml(body)}</pre>` : ''}
        ${filesHtml}
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Build log — zapweave</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Public build log: every commit shipped across Shinobi, OpenGravity and shinobi-bench." />
<link rel="alternate" type="application/rss+xml" title="zapweave build log" href="/feed.xml" />
<link rel="stylesheet" href="styles.css" />
<style>
  .build-log { max-width: var(--max-w); margin: 0 auto; padding: 64px 32px 96px; }
  .build-log h1 { font-size: 32px; margin-bottom: 8px; letter-spacing: -0.01em; }
  .build-log .lead { color: var(--text-dim); margin-bottom: 28px; max-width: 720px; }
  .build-log .entry { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 22px; margin-bottom: 14px; }
  .build-log .entry header { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; font-size: 13px; color: var(--text-dim); margin-bottom: 8px; }
  .build-log .entry h2 { font-size: 16px; margin: 4px 0; color: var(--text); }
  .build-log .entry pre { background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-size: 13px; color: var(--text-dim); overflow-x: auto; white-space: pre-wrap; }
  .build-log .repo-pill { color: #0a0a0b; font-weight: 600; padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: lowercase; letter-spacing: 0.04em; }
  .build-log .hash { color: var(--accent); font-family: ui-monospace, "Menlo", "Consolas", monospace; text-decoration: none; font-size: 13px; }
  .build-log .hash:hover { text-decoration: underline; }
  .build-log time { color: var(--text-faint); font-size: 12px; font-family: ui-monospace, monospace; }
  .build-log .author { color: var(--text-faint); font-size: 12px; }
  .build-log details { margin-top: 8px; font-size: 13px; color: var(--text-dim); }
  .build-log details ul { list-style: none; padding-left: 0; margin-top: 6px; }
  .build-log details li { padding: 2px 0; }
  .build-log details .diff { color: var(--text-faint); font-size: 11px; }
  .build-log .meta { color: var(--text-faint); font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<main class="build-log">
  <h1>Build log</h1>
  <p class="lead">Every commit shipped across the Shinobi ecosystem. Auto-generated from GitHub on every push to main of any of the three repos.</p>
  <p class="lead">RSS / Atom: <a href="/feed.xml">/feed.xml</a></p>
  ${items}
  <p class="meta">Generated ${generatedAt} from ${REPOS.map((r) => r.label).join(' + ')}.</p>
</main>
</body></html>
`;
}

function renderRss(entries, generatedAt) {
  const items = entries.map((e) => {
    const title = e.message.split('\n')[0].slice(0, 240);
    return `
    <item>
      <title>[${e.repo_label}] ${escapeXml(title)}</title>
      <link>${e.url}</link>
      <guid isPermaLink="false">${e.repo}@${e.sha}</guid>
      <pubDate>${new Date(e.date).toUTCString()}</pubDate>
      <author>noreply@zapweave.com (${escapeXml(e.author)})</author>
      <description>${escapeXml(e.message.slice(0, 4000))}</description>
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>zapweave build log</title>
    <link>https://zapweave.com/build-log.html</link>
    <description>Every commit shipped across Shinobi, OpenGravity and shinobi-bench.</description>
    <language>en-US</language>
    <lastBuildDate>${generatedAt}</lastBuildDate>
    <generator>shinobi-build-log/1.0</generator>
    ${items}
  </channel>
</rss>
`;
}

async function main() {
  console.log(`[build-log] fetching commits from ${REPOS.length} repos...`);
  const all = [];
  for (const repo of REPOS) {
    try {
      const commits = await fetchCommits(repo);
      console.log(`[build-log] ${repo.full}: ${commits.length} commits`);
      all.push(...commits);
    } catch (e) {
      console.warn(`[build-log] WARN ${repo.full}: ${e.message}`);
    }
  }
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  const trimmed = all.slice(0, TOTAL_LIMIT);
  const generatedAt = new Date().toUTCString();

  if (!existsSync(dirname(OUT_HTML))) mkdirSync(dirname(OUT_HTML), { recursive: true });
  writeFileSync(OUT_HTML, renderHtml(trimmed, generatedAt), 'utf-8');
  writeFileSync(OUT_RSS, renderRss(trimmed, generatedAt), 'utf-8');
  console.log(`[build-log] wrote ${OUT_HTML} (${trimmed.length} entries) + ${OUT_RSS}`);
}

main().catch((e) => { console.error('[build-log] FAIL', e); process.exit(1); });
