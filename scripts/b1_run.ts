// B.1 runner — ejecuta /self una vez para producir el primer self_report.
import { runSelf } from '../src/reader/self.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('B.1 — /self (Shinobi se lee a sí mismo)');
  console.log('═══════════════════════════════════════════════════════════════');
  const r = await runSelf({});
  if (!r.ok) {
    console.error('[b1_run] FAILED — no self_report generated');
    process.exit(1);
  }
  console.log(`[b1_run] OK — self_report at ${r.selfReportPath}`);
}

main().catch((e) => { console.error('[b1_run] FATAL:', e); process.exit(1); });
