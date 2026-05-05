// B.2 runner — ejecuta /committee sobre el último self_report.
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';

async function main() {
  const target = findLatestSelfReport();
  if (!target) {
    console.error('[b2_run] no self_reports/ found — run B.1 first');
    process.exit(1);
  }
  console.log(`[b2_run] target: ${target}`);
  const r = await runCommittee(target);
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => { console.error('[b2_run] FATAL:', e); process.exit(2); });
