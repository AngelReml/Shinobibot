// F1 gate — 5 audits del mismo SHA execa, verificar verdicts idénticos.
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { runAudit } from '../src/audit/runAudit.js';

async function main() {
  const local = 'C:\\Users\\angel\\Desktop\\test_repos\\execa';
  let sha = 'f3a2e8481a1e9138de3895827895c834078b9456';
  if (fs.existsSync(local)) {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: local, encoding: 'utf-8' });
    if (r.status === 0) sha = (r.stdout || '').trim();
  }
  console.log(`F1 gate — 5 audits con SHA ${sha.slice(0, 8)}`);

  const verdicts: string[] = [];
  const confidences: (string | undefined)[] = [];
  for (let i = 0; i < 5; i++) {
    console.log(`\nrun ${i + 1}/5`);
    const r = await runAudit({ url: 'https://github.com/sindresorhus/execa', commit: sha });
    verdicts.push(r.verdict);
    // Read the committee file to extract confidence.
    const machine = `audits/.machine/${r.sha}_committee.json`;
    if (fs.existsSync(machine)) {
      const cmt = JSON.parse(fs.readFileSync(machine, 'utf-8'));
      confidences.push(cmt?.synthesis?.verdict_confidence);
    } else confidences.push(undefined);
  }

  console.log('');
  console.log('═══ F1 GATE RESULT ═══');
  console.log(`verdicts:    [${verdicts.join(', ')}]`);
  console.log(`confidences: [${confidences.join(', ')}]`);
  const allEqual = verdicts.every((v) => v === verdicts[0]);
  console.log(`all_equal:   ${allEqual ? 'YES ✅ (gate F1 verde)' : 'NO ❌ (gate F1 rojo)'}`);
  process.exit(allEqual ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
