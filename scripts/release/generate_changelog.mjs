#!/usr/bin/env node
// G3.2 — Generate a Markdown changelog from the conventional commits between
// the previous git tag (or first commit) and HEAD.
//
// Output goes to stdout — the release CI captures it and feeds it to
// `gh release create`. Run locally as:
//
//     node scripts/release/generate_changelog.mjs            # since last tag
//     node scripts/release/generate_changelog.mjs v0.9.0     # since v0.9.0
import { execSync } from 'node:child_process';

const argFrom = process.argv[2];

function safeExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf-8' }).trim(); }
  catch { return ''; }
}

const previousTag = argFrom || safeExec('git describe --tags --abbrev=0 HEAD~1') || '';
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';

// Format: "<sha>\t<subject>"
const log = safeExec(`git log ${range} --pretty=format:%h%x09%s`);
const lines = log.split('\n').filter(Boolean);

const groups = {
  feat: { title: 'Features', items: [] },
  fix: { title: 'Bug Fixes', items: [] },
  perf: { title: 'Performance', items: [] },
  refactor: { title: 'Refactor', items: [] },
  test: { title: 'Tests', items: [] },
  docs: { title: 'Documentation', items: [] },
  build: { title: 'Build', items: [] },
  ci: { title: 'CI', items: [] },
  chore: { title: 'Chores', items: [] },
  style: { title: 'Style', items: [] },
  other: { title: 'Other', items: [] },
  release: { title: 'Releases', items: [] },
};

for (const line of lines) {
  const [sha, ...rest] = line.split('\t');
  const subject = rest.join('\t');
  // Match conventional commits: type(scope): subject
  const m = subject.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i);
  let group = 'other';
  let scope = '';
  let body = subject;
  if (m) {
    const t = m[1].toLowerCase();
    if (groups[t]) { group = t; scope = m[2] ?? ''; body = m[3]; }
  }
  groups[group].items.push({ sha, scope, body });
}

const totalEntries = Object.values(groups).reduce((s, g) => s + g.items.length, 0);
const today = new Date().toISOString().slice(0, 10);
const headerRange = previousTag ? `${previousTag}…HEAD` : 'initial';

const lines_out = [];
lines_out.push(`## Changelog (${headerRange}) — ${today}`);
lines_out.push('');
lines_out.push(`${totalEntries} commit${totalEntries === 1 ? '' : 's'} grouped below.`);
lines_out.push('');
const order = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'build', 'ci', 'release', 'chore', 'style', 'other'];
for (const k of order) {
  const g = groups[k];
  if (g.items.length === 0) continue;
  lines_out.push(`### ${g.title}`);
  for (const it of g.items) {
    const scope = it.scope ? ` **${it.scope}**:` : '';
    lines_out.push(`- ${it.sha}${scope} ${it.body.replace(/[\r\n]+/g, ' ').slice(0, 240)}`);
  }
  lines_out.push('');
}

process.stdout.write(lines_out.join('\n') + '\n');
