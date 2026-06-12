// scripts/bench_s_agentic.ts — corre la suite S-AGENTIC (diferenciadores).
//
//   npx tsx scripts/bench_s_agentic.ts
//
// Qué hace:
//  1. Arranca el sitio-fixture (demos/bench_site/serve.mjs) en 127.0.0.1:8770.
//  2. Espera a que responda /health.
//  3. Corre S_AGENTIC_TASKS contra Shinobi (+ competidores de bench.config.json
//     si están disponibles; los no instalados se saltan limpio).
//  4. Escribe report.md + results.json en bench_results/ y para el fixture.
//
// Requiere runtime real (navegador + provider). Se ejecuta en la máquina del
// operador, no en el sandbox. REGLA: si comparas con Hermes/OpenClaw, los TRES
// con el MISMO modelo (ver ESTRATEGIA_DIFERENCIADORES §4).

import '../src/tools/index.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runBenchmark, summarize, toMarkdown, S_AGENTIC_TASKS, S_AGENTIC_VERSION, ShinobiAdapter,
} from '../src/bench/index.js';
import { loadBenchConfig, competitorAdapters } from '../src/bench/config.js';
import { writeResults } from '../src/bench/results.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = process.env.BENCH_SITE_URL || 'http://127.0.0.1:8770';

async function waitHealthy(url: string, tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`${url}/health`)).ok) return true; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  // 1. Fixture
  const serverPath = join(__dirname, '..', 'demos', 'bench_site', 'serve.mjs');
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, BENCH_SITE_SILENT: '1' }, stdio: 'ignore', windowsHide: true,
  });
  const cleanup = () => { try { server.kill(); } catch { /* */ } };
  process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(1); });

  if (!(await waitHealthy(SITE))) {
    cleanup();
    console.error(`[s-agentic] el fixture no respondió en ${SITE}. ¿Puerto ocupado?`);
    process.exit(1);
  }
  console.log(`[s-agentic] fixture arriba en ${SITE} · suite ${S_AGENTIC_VERSION} · ${S_AGENTIC_TASKS.length} tareas`);

  // 2. Agentes: Shinobi + competidores disponibles (se saltan los no instalados)
  const competitors = competitorAdapters(loadBenchConfig());
  const adapters = [new ShinobiAdapter(), ...competitors];
  const avail: typeof adapters = [];
  for (const a of adapters) {
    const ok = typeof (a as any).isAvailable === 'function' ? await (a as any).isAvailable() : true;
    if (ok) avail.push(a); else console.log(`  (saltado: ${a.id} no disponible)`);
  }
  console.log(`[s-agentic] agentes: ${avail.map((a) => a.id).join(', ')}`);

  // 3. Correr
  const results = await runBenchmark(S_AGENTIC_TASKS, avail, {
    onResult: (r) => console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.agent}/${r.task} — ${r.checkDetail}`),
  });

  // 4. Escribir + cerrar
  const out = writeResults(results, 'bench_results', {
    at: new Date().toISOString(), suite: 'S-AGENTIC', version: S_AGENTIC_VERSION, tasks: S_AGENTIC_TASKS.length,
  });
  console.log('\n' + toMarkdown(summarize(results)));
  console.log(`\n[s-agentic] escrito: ${out.reportPath}`);
  cleanup();
}

main().catch((e) => { console.error('[s-agentic] THREW', e?.message ?? e); process.exit(1); });
