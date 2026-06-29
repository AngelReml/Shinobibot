// scripts/bench_s_code.ts — harness-delta: S-CODE × agentes configurados.
//
// Primera corrida firmada de la suite S-CODE (G1). Corre las 25 tareas contra
// shinobi + los competidores disponibles en bench.config.json, escribe los
// resultados en bench_results/ con sha256 adjunto (paquete de "provable autonomy").
//
// Uso:
//   npx tsx scripts/bench_s_code.ts [--concurrency N] [--no-competitors]
//   npx tsx scripts/bench_s_code.ts --mock   (modo mock: sin LLM, para CI)
//
// Salida:
//   bench_results/s_code_<ISO>.md
//   bench_results/s_code_<ISO>.json
//   bench_results/s_code_<ISO>.sha256

import '../src/tools/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  runBenchmark, summarize, toMarkdown,
  S_CODE_TASKS, S_CODE_VERSION,
  ShinobiAdapter, MockAdapter,
} from '../src/bench/index.js';
import { loadBenchConfig, competitorAdapters } from '../src/bench/config.js';
import type { BenchResult } from '../src/bench/types.js';

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    concurrency: Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 1),
    noCompetitors: args.includes('--no-competitors'),
    mock: args.includes('--mock'),
  };
}

async function main() {
  const opts = parseArgs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(process.cwd(), 'bench_results');
  fs.mkdirSync(outDir, { recursive: true });

  const mockPass = async () => ({ finalText: 'mock-pass', ok: true, iterations: 1, toolsUsed: [], durationMs: 1 });
  const mockFail = async () => ({ finalText: 'mock-fail', ok: false, iterations: 1, toolsUsed: [], durationMs: 1 });
  const adapters = opts.mock
    ? [new MockAdapter('mock-pass', mockPass), new MockAdapter('mock-fail', mockFail)]
    : [
        new ShinobiAdapter({ gated: true }),
        ...(opts.noCompetitors ? [] : competitorAdapters(loadBenchConfig())),
      ];

  console.log(
    `[bench:s_code] suite=${S_CODE_VERSION} · ${S_CODE_TASKS.length} tareas · ` +
    `agentes: ${adapters.map((a) => a.id).join(', ')} · concurrency=${opts.concurrency}`,
  );

  const results: BenchResult[] = await runBenchmark(S_CODE_TASKS, adapters, {
    concurrency: opts.concurrency,
    onResult: (r) =>
      console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.agent}/${r.task} (${r.durationMs}ms) — ${r.checkDetail}`),
  });

  const report = summarize(results);
  const md = [
    `# S-CODE harness-delta — ${stamp}`,
    `> Suite: ${S_CODE_VERSION} · ${S_CODE_TASKS.length} tareas · agentes: ${adapters.map((a) => a.id).join(', ')}`,
    '',
    toMarkdown(report),
    '',
    '## Detalle por tarea',
    '',
    '| Agente | Tarea | Pass | ms | Detalle |',
    '|---|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.agent} | ${r.task} | ${r.pass ? '✅' : '❌'} | ${r.durationMs} | ${r.checkDetail.slice(0, 60)} |`,
    ),
  ].join('\n');

  const mdPath = path.join(outDir, `s_code_${stamp}.md`);
  const jsonPath = path.join(outDir, `s_code_${stamp}.json`);
  const sha256Path = path.join(outDir, `s_code_${stamp}.sha256`);

  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify({ version: S_CODE_VERSION, stamp, results }, null, 2));

  const mdHash = sha256File(mdPath);
  const jsonHash = sha256File(jsonPath);
  fs.writeFileSync(sha256Path, `${mdHash}  s_code_${stamp}.md\n${jsonHash}  s_code_${stamp}.json\n`);

  console.log('\n' + toMarkdown(report));
  console.log(`\n[bench:s_code] escrito: ${mdPath}`);
  console.log(`[bench:s_code] sha256:  ${sha256Path}`);
}

main().catch((e) => {
  console.error('[bench:s_code] THREW', e?.message ?? e);
  process.exit(1);
});
