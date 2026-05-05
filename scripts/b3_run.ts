// B.3 runner — invoca runImprovements sobre el último committee_report.
import { runImprovements } from '../src/committee/improvements.js';

async function main() {
  const r = await runImprovements();
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => { console.error('[b3_run] FATAL:', e); process.exit(2); });
