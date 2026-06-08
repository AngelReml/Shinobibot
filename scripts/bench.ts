// scripts/bench.ts — entry ejecutable del benchmark.
//   npm run bench
// Corre la suite contra shinobi + los competidores declarados en bench.config.json
// (se saltan los no disponibles) y escribe bench-results/{report.md,results.json}.
import '../src/tools/index.js';
import {
  runBenchmark, summarize, toMarkdown, BENCH_TASKS, ShinobiAdapter,
} from '../src/bench/index.js';
import { loadBenchConfig, competitorAdapters } from '../src/bench/config.js';
import { writeResults } from '../src/bench/results.js';

async function main() {
  const adapters = [new ShinobiAdapter(), ...competitorAdapters(loadBenchConfig())];
  console.log(`[bench] agentes: ${adapters.map((a) => a.id).join(', ')} · ${BENCH_TASKS.length} tareas`);
  const results = await runBenchmark(BENCH_TASKS, adapters, {
    onResult: (r) => console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.agent}/${r.task} — ${r.checkDetail}`),
  });
  const out = writeResults(results, 'bench-results', { at: new Date().toISOString(), tasks: BENCH_TASKS.length });
  console.log('\n' + toMarkdown(summarize(results)));
  console.log(`\n[bench] escrito: ${out.reportPath}`);
}
main().catch((e) => { console.error('[bench] THREW', e?.message ?? e); process.exit(1); });
