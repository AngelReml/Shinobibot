// scripts/bench_g2.ts — G2: consistencia pass^k sobre S-CODE + S-POLICY.
//
// Métrica de cierre de G2: pass^5(shinobi) > pass^5(Hermes) y pass^5(OpenClaw)
// sobre el mismo modelo en ≥2 suites (PLAN_SOMBRA §G2).
//
// Uso:
//   npx tsx scripts/bench_g2.ts [--k N] [--suite s_code|s_policy|all] [--mock]
//   npx tsx scripts/bench_g2.ts --k 5 --suite all      (corrida completa G2)
//   npx tsx scripts/bench_g2.ts --k 3 --suite s_code   (dev rápido)
//   npx tsx scripts/bench_g2.ts --mock                  (CI sin LLM)

import '../src/tools/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  runBenchmark, summarize, toMarkdown,
  S_CODE_TASKS, S_CODE_VERSION,
  S_POLICY_TASKS, S_POLICY_VERSION,
  ShinobiAdapter, MockAdapter,
} from '../src/bench/index.js';
import { loadBenchConfig, competitorAdapters } from '../src/bench/config.js';
import type { BenchResult } from '../src/bench/types.js';

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const k = Number(args.find((a) => a.startsWith('--k='))?.split('=')[1] ??
    args[args.indexOf('--k') + 1] ?? 5);
  const suiteArg = args.find((a) => a.startsWith('--suite='))?.split('=')[1] ??
    args[args.indexOf('--suite') + 1] ?? 'all';
  return {
    k: Math.max(1, k),
    suite: suiteArg as 's_code' | 's_policy' | 'all',
    mock: args.includes('--mock'),
    concurrency: Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 1),
    noCompetitors: args.includes('--no-competitors'),
  };
}

async function main() {
  const opts = parseArgs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(process.cwd(), 'bench_results');
  fs.mkdirSync(outDir, { recursive: true });

  const tasks = opts.suite === 's_code' ? S_CODE_TASKS
    : opts.suite === 's_policy' ? S_POLICY_TASKS
    : [...S_CODE_TASKS, ...S_POLICY_TASKS];

  const suiteLabel = opts.suite === 'all'
    ? `S-CODE(${S_CODE_VERSION})+S-POLICY(${S_POLICY_VERSION})`
    : opts.suite === 's_code' ? `S-CODE(${S_CODE_VERSION})` : `S-POLICY(${S_POLICY_VERSION})`;

  const mockPass = async () => ({ finalText: 'mock-pass', ok: true, iterations: 1, toolsUsed: [], durationMs: 1 });
  const mockFail = async () => ({ finalText: 'mock-fail', ok: false, iterations: 1, toolsUsed: [], durationMs: 1 });
  const adapters = opts.mock
    ? [new MockAdapter('mock-pass', mockPass), new MockAdapter('mock-fail', mockFail)]
    : [
        new ShinobiAdapter({ gated: true }),
        ...(opts.noCompetitors ? [] : competitorAdapters(loadBenchConfig())),
      ];

  console.log(
    `[bench:g2] k=${opts.k} · suite=${suiteLabel} · ${tasks.length} tareas · ` +
    `agentes: ${adapters.map((a) => a.id).join(', ')} · concurrency=${opts.concurrency}`,
  );
  console.log(`[bench:g2] métrica de cierre: pass^${opts.k}(shinobi) > pass^${opts.k}(competidores) en ≥2 suites`);

  const results: BenchResult[] = await runBenchmark(tasks, adapters, {
    concurrency: opts.concurrency,
    repeat: opts.k,
    onResult: (r) => {
      const kLabel = r.runs ? ` pass^${opts.k}=${r.passK ? '✅' : '❌'}` : '';
      console.log(`  [${r.pass ? 'PASS' : 'FAIL'}${kLabel}] ${r.agent}/${r.task} (${r.durationMs}ms)`);
    },
  });

  const report = summarize(results);
  const md = [
    `# G2 — Consistencia pass^${opts.k} — ${stamp}`,
    `> Suite: ${suiteLabel} · ${tasks.length} tareas · k=${opts.k} · agentes: ${adapters.map((a) => a.id).join(', ')}`,
    `> Métrica de cierre G2: pass^${opts.k}(shinobi) > pass^${opts.k}(competidores) en ≥2 suites`,
    '',
    toMarkdown(report),
    '',
    '## Detalle pass^k por tarea',
    '',
    '| Agente | Tarea | pass@1 | pass^k | Runs | ms total |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => {
      const runsStr = r.runs ? `${r.runs.filter((x) => x.pass).length}/${r.runs.length}` : '1/1';
      const kStr = r.runs ? (r.passK ? '✅' : '❌') : '—';
      return `| ${r.agent} | ${r.task} | ${r.pass ? '✅' : '❌'} | ${kStr} | ${runsStr} | ${r.durationMs} |`;
    }),
  ].join('\n');

  const tag = `g2_k${opts.k}_${stamp}`;
  const mdPath = path.join(outDir, `${tag}.md`);
  const jsonPath = path.join(outDir, `${tag}.json`);
  const sha256Path = path.join(outDir, `${tag}.sha256`);

  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify({ k: opts.k, suite: opts.suite, stamp, suiteLabel, results }, null, 2));
  const mdHash = sha256File(mdPath);
  const jsonHash = sha256File(jsonPath);
  fs.writeFileSync(sha256Path, `${mdHash}  ${path.basename(mdPath)}\n${jsonHash}  ${path.basename(jsonPath)}\n`);

  console.log('\n' + toMarkdown(report));
  console.log(`\n[bench:g2] escrito: ${mdPath}`);
  console.log(`[bench:g2] sha256:  ${sha256Path}`);

  // Veredicto G2 automático (solo cuando hay datos de k repeticiones reales).
  const shinobi = report.agents.find((a) => a.agent === 'shinobi');
  const rivals = report.agents.filter((a) => a.agent !== 'shinobi' && a.passKTotal > 0);
  if (shinobi && shinobi.passKTotal > 0 && rivals.length > 0) {
    const leads = rivals.filter((r) => shinobi.passKRate > r.passKRate).length;
    console.log(`\n[bench:g2] VEREDICTO: shinobi pass^${opts.k}=${Math.round(shinobi.passKRate * 100)}% · lidera en ${leads}/${rivals.length} rivales`);
    console.log(`[bench:g2] G2 cierra si leads ≥ ${Math.ceil(rivals.length / 2)} y los lidera en ≥2 suites.`);
  }
}

main().catch((e) => {
  console.error('[bench:g2] THREW', e?.message ?? e);
  process.exit(1);
});
