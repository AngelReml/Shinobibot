// D.4 runner — completa 10 misiones reales y verifica la cadena.
// Las primeras 3 son audits sobre execa (pinned). Las siguientes 7 son
// audits sobre repos pequenos distintos para variar input_hash. Al final:
// /ledger verify + /ledger export.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runAudit } from '../src/audit/runAudit.js';
import { MissionLedger } from '../src/ledger/MissionLedger.js';

const TARGETS: { url: string; commit?: string }[] = [
  // 3 over execa (pinned to the SHA used in D.3 to keep determinism)
  { url: 'https://github.com/sindresorhus/execa', commit: undefined },
  { url: 'https://github.com/sindresorhus/execa', commit: undefined },
  { url: 'https://github.com/sindresorhus/execa', commit: undefined },
  // 7 over tiny repos by sindresorhus (chosen for size; vary the input hash)
  { url: 'https://github.com/sindresorhus/is-png' },
  { url: 'https://github.com/sindresorhus/sort-on' },
  { url: 'https://github.com/sindresorhus/dot-prop' },
  { url: 'https://github.com/sindresorhus/is-stream' },
  { url: 'https://github.com/sindresorhus/strip-final-newline' },
  { url: 'https://github.com/sindresorhus/escape-string-regexp' },
  { url: 'https://github.com/sindresorhus/p-event' },
];

async function main() {
  // Pin execa SHA from local clone if available
  const localExeca = 'C:\\Users\\angel\\Desktop\\test_repos\\execa';
  let pinnedSha: string | undefined;
  if (fs.existsSync(localExeca)) {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: localExeca, encoding: 'utf-8' });
    if (r.status === 0) pinnedSha = (r.stdout || '').trim();
  }
  for (let i = 0; i < 3; i++) TARGETS[i].commit = pinnedSha;

  const ledger = new MissionLedger();
  const startCount = ledger.count();
  console.log(`[d4_run] ledger starts with ${startCount} entries`);
  console.log(`[d4_run] will run ${TARGETS.length} audits → target tail count = ${startCount + TARGETS.length}`);
  console.log('');

  const summary: { idx: number; url: string; ok: boolean; verdict: string; durationMs: number; entryHash: string }[] = [];

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`D.4 — RUN ${i + 1}/${TARGETS.length}  (${t.url})`);
    console.log('═══════════════════════════════════════════════════════════════');
    let entryHash = '';
    let ok = false, verdict = '?', durationMs = 0;
    try {
      const r = await runAudit({ url: t.url, commit: t.commit });
      ok = r.ok;
      verdict = r.verdict;
      durationMs = r.durationMs;
    } catch (e: any) {
      console.error(`[d4_run] audit threw: ${e?.message ?? e}`);
    }
    const tail = ledger.tail();
    if (tail) entryHash = tail.self_hash.slice(0, 12);
    summary.push({ idx: i + 1, url: t.url, ok, verdict, durationMs, entryHash });
    console.log('');
  }

  // /ledger verify
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('D.4 — /ledger verify');
  console.log('═══════════════════════════════════════════════════════════════');
  const v = ledger.verify();
  console.log(`entries:    ${v.entries}`);
  console.log(`integrity:  ${v.ok ? 'INTACT ✅' : 'BROKEN ❌'}`);
  if (!v.ok) for (const b of v.breakages) console.log(`  - [${b.index}] ${b.reason}`);

  // /ledger export
  const exp = ledger.export();
  const exportPath = path.join(process.cwd(), 'ledger', `export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(exp, null, 2));
  console.log('');
  console.log(`[d4_run] export → ${exportPath}`);
  console.log(`[d4_run] head hash = ${exp.head.slice(0, 16)}…`);

  // Summary doc
  const doc = path.join(process.cwd(), 'docs', 'D4_VALIDATION.md');
  const lines: string[] = [];
  lines.push('# D.4 — MissionLedger validation');
  lines.push('');
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push(`Entries totales: **${v.entries}**`);
  lines.push(`Integrity verify: **${v.ok ? 'INTACT ✅' : 'BROKEN ❌'}**`);
  lines.push(`Head: \`${exp.head}\``);
  lines.push(`Export file: \`${path.relative(process.cwd(), exportPath)}\``);
  lines.push('');
  lines.push(`Gate D.4: 10 misiones reales con \`/ledger verify\` reportando 0 rupturas.`);
  lines.push(`Estado: **${v.entries >= 10 && v.ok ? 'VERDE — gate cumplido' : (v.ok ? 'PARCIAL (chain integra, faltan misiones para 10)' : 'ROJO — chain corrupta')}**`);
  lines.push('');
  lines.push('| # | URL | OK | Verdict | Duration | Entry hash |');
  lines.push('|---|-----|----|---------|----------|------------|');
  for (const s of summary) {
    lines.push(`| ${s.idx} | \`${s.url}\` | ${s.ok ? '✅' : '❌'} | ${s.verdict} | ${(s.durationMs / 1000).toFixed(1)}s | \`${s.entryHash}…\` |`);
  }
  fs.writeFileSync(doc, lines.join('\n') + '\n');
  console.log(`[d4_run] summary written to ${doc}`);

  process.exit(v.ok && v.entries >= 10 ? 0 : 1);
}

main().catch((e) => { console.error('[d4_run] FATAL:', e); process.exit(2); });
