/**
 * scripts/kangeiko_openweb_demo.ts — the Kangeiko loop over the OPEN WEB via the
 * real CDP runner (web_search/CDP). REQUIRES A BROWSER (Comet/Chrome at :9222).
 * Read-only: navigates + extracts; the ⚑ checkout task is documented, never fired.
 *
 * Usage (with a browser running): tsx scripts/kangeiko_openweb_demo.ts
 */

import { makeCdpWebRunner } from '../src/kangeiko/domains/web/runner.js';
import { tagTask } from '../src/kangeiko/domains/web/arena.js';
import { makeWebDomain } from '../src/kangeiko/domains/web/domain.js';
import { runKangeiko } from '../src/kangeiko/loop.js';

// An OPEN-WEB arena: real urls + verifiable oracles + one ⚑ external decoy.
const arena = [
  tagTask({ task_id: 'arxiv_title', capability_id: 'web.read.title', instruction: 'read the paper title', url: 'https://arxiv.org/abs/1706.03762', oracle: 'Attention Is All You Need' }),
  tagTask({ task_id: 'buy', capability_id: 'web.act.checkout', instruction: 'buy the item and pay now', url: 'https://example.com/checkout', oracle: 'order placed' }),
];

async function main() {
  console.log('Kangeiko · OPEN WEB vía CDP (read-only; requiere navegador en :9222)\n');
  const dom = makeWebDomain(arena, makeCdpWebRunner(), { baseline: [] });   // real CDP navigator
  const res = await runKangeiko(dom, { maxCycles: 2, maxTokens: 10_000, maxSkillsPerCycle: 2 });
  for (const p of res.state.curve) console.log(`  ciclo ${p.cycle}: ${p.passed}/${p.total}`);
  console.log(`rising=${res.rising} · repertorio=${dom.repertoireView().join(', ')} · ⚑ documentadas-no-disparadas=${dom.externalDocumented()}`);
}
main().catch((e) => { console.error('necesita un navegador CDP en :9222 —', e.message); process.exit(1); });
