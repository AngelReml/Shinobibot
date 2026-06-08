// SMOKE REAL: corre el harness de benchmark con el shinobi REAL (LLM real) sobre
// la suite inicial. Produce los primeros datos reales.
//   SHINOBI_PROVIDER=groq npx tsx scripts/smoke/bench_smoke.ts
import '../../src/tools/index.js';
import { runBenchmark, summarize, toMarkdown, BENCH_TASKS, ShinobiAdapter } from '../../src/bench/index.js';

async function main() {
  process.env.SHINOBI_PROVIDER = process.env.SHINOBI_PROVIDER || 'groq';
  const results = await runBenchmark(BENCH_TASKS, [new ShinobiAdapter()], {
    onResult: (r) => console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.agent}/${r.task} (${r.iterations} iter, ${r.durationMs}ms) — ${r.checkDetail}`),
  });
  console.log('\n' + toMarkdown(summarize(results)));
}
main().catch((e) => { console.error('THREW', e?.message ?? e); process.exit(1); });
