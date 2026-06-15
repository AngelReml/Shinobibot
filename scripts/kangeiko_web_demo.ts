/**
 * scripts/kangeiko_web_demo.ts — the Kangeiko web loop over a REAL served dojo.
 * Serves the closed-dojo fixtures locally, runs the self-improvement loop with the
 * HTTP runner (real fetch + extract + oracle match), prints the rising curve, and
 * shows the payment task documented-not-fired. Usage: tsx scripts/kangeiko_web_demo.ts
 */

import { serveDojo } from '../src/kangeiko/domains/web/server.js';
import { makeHttpWebRunner } from '../src/kangeiko/domains/web/runner.js';
import { closedDojoArena } from '../src/kangeiko/domains/web/arena.js';
import { makeWebDomain } from '../src/kangeiko/domains/web/domain.js';
import { runKangeiko } from '../src/kangeiko/loop.js';

async function main() {
  const dojo = await serveDojo();
  console.log(`Kangeiko · dojo cerrado servido en ${dojo.url}\n`);
  const dom = makeWebDomain(closedDojoArena(), makeHttpWebRunner(dojo.url), { baseline: [] });
  const res = await runKangeiko(dom, { maxCycles: 3, maxTokens: 10_000, maxSkillsPerCycle: 3 });

  console.log('Curva de capacidad web (passed/total, por medición):');
  for (const p of res.state.curve) console.log(`  ciclo ${p.cycle}: ${p.passed}/${p.total}`);
  console.log(`\nrising = ${res.rising} (delta +${(res.delta * 100).toFixed(0)}%)`);
  console.log(`repertorio certificado (capacidades): ${dom.repertoireView().join(', ')}`);
  console.log(`⚑ tareas de efecto externo documentadas (NO disparadas): ${dom.externalDocumented()}`);
  await dojo.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
