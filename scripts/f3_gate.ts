// F3 gate — ejecuta /self → /committee → /improvements; verifica:
//   1. al menos 3 propuestas marcadas como aplicables (ok|fuzzy)
//   2. /apply sobre una de ellas modifica el archivo correctamente
//   3. tsc --noEmit sigue limpio en modulos del plan v1.0
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runSelf } from '../src/reader/self.js';
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';
import { runImprovements, applyProposal } from '../src/committee/improvements.js';

async function main() {
  console.log('F3 gate — /self → /committee → /improvements → /apply');

  // Refresh self_report (committee voting needs a recent one).
  await runSelf({});
  const target = findLatestSelfReport();
  if (!target) { console.error('no self_report'); process.exit(1); }
  await runCommittee(target);

  const r = await runImprovements();
  if (!r.ok) { console.error('improvements failed'); process.exit(1); }

  // Categorize proposals.
  const applicable = r.proposals.filter((p) => p.applicability === 'ok' || p.applicability === 'fuzzy');
  const broken = r.proposals.filter((p) => p.applicability === 'broken');
  console.log(`\napplicable: ${applicable.length} (ok=${r.proposals.filter((p) => p.applicability === 'ok').length}, fuzzy=${r.proposals.filter((p) => p.applicability === 'fuzzy').length})`);
  console.log(`broken:     ${broken.length}`);

  if (applicable.length < 3) {
    console.error(`\nFAIL: <3 applicable proposals (got ${applicable.length})`);
    console.error(`Proposals: ${r.proposals.map((p) => `${p.id}=${p.applicability}`).join(', ')}`);
    process.exit(1);
  }

  // Pick first low-risk applicable proposal whose target file exists.
  const candidate = applicable.find((p) => p.risk === 'low' && fs.existsSync(p.file)) ?? applicable[0];
  console.log(`\napplying: ${candidate.id} (${candidate.file}, risk=${candidate.risk}, applicability=${candidate.applicability})`);

  // Baseline tsc errors BEFORE apply — repo may have preexisting errors that
  // are out of scope for F3. We only fail on errors INTRODUCED by the apply.
  const tscBaseline = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf-8', shell: true });
  const baselineErrors = new Set(
    (tscBaseline.stdout || '').split('\n')
      .filter((l) => /^(src\/(reader|committee|knowledge|audit|ledger|gateway)|scripts\/shinobi)/.test(l))
  );
  console.log(`baseline tsc errors in plan modules: ${baselineErrors.size}`);

  // Capture pre-apply state of the target file ONLY (we revert just that file
  // afterwards — `git checkout -- .` would destroy unrelated working changes).
  const targetFile = candidate.file;
  const targetExisted = fs.existsSync(targetFile);
  const targetBackup = targetExisted ? fs.readFileSync(targetFile, 'utf-8') : null;

  const apply = await applyProposal(candidate.id, async () => 'y');
  if (!apply.ok) {
    console.error(`apply failed: ${apply.message}`);
    if (targetBackup !== null) fs.writeFileSync(targetFile, targetBackup);
    process.exit(1);
  }

  // Confirm git diff is non-empty for the target file specifically.
  const diff = spawnSync('git', ['diff', '--', targetFile], { encoding: 'utf-8' });
  const diffNonEmpty = (diff.stdout || '').length > 0;
  console.log(`git diff non-empty (${targetFile}): ${diffNonEmpty}`);

  // tsc --noEmit on plan v1.0 modules — only count NEW errors vs baseline.
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf-8', shell: true });
  const tscRelevant = (tsc.stdout || '').split('\n').filter((l) => /^(src\/(reader|committee|knowledge|audit|ledger|gateway)|scripts\/shinobi)/.test(l));
  const newErrors = tscRelevant.filter((l) => !baselineErrors.has(l));
  const tscClean = newErrors.length === 0;
  console.log(`tsc no NEW errors after apply: ${tscClean}${tscClean ? '' : `\nnew errors:\n${newErrors.join('\n')}`}`);

  // Surgical revert — only the file we touched.
  if (targetBackup !== null) fs.writeFileSync(targetFile, targetBackup);
  else if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);

  const pass = diffNonEmpty && tscClean;
  console.log('');
  console.log('═══ F3 GATE RESULT ═══');
  console.log(`gate: ${pass ? 'VERDE ✅' : 'ROJO ❌'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
