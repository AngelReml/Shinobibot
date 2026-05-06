// F3 — checkProposalApplicability against synthetic git repo.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { checkProposalApplicability, type Proposal } from '../improvements.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-'));
spawnSync('git', ['init', '-q', tmp], { cwd: tmp });
fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n');
spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=t@t', 'add', '.'], { cwd: tmp });
spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: tmp });

console.log('F3 — checkProposalApplicability');

// Case 1: a clean diff that applies straight.
const cleanDiff = `--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 export const x = 1;
 export const y = 2;
 export const z = 3;
+export const w = 4;
`;
const p1: Proposal = { id: 'clean', file: 'a.ts', motive: 'add w', risk: 'low', diff: cleanDiff };
const r1 = checkProposalApplicability(p1, tmp);
t('clean diff → ok', r1.applicability === 'ok');

// Case 2: a diff with bogus context (line numbers off + wrong content).
const broken = `--- a/a.ts
+++ b/a.ts
@@ -42,3 +42,4 @@
 line that does not exist anywhere
 another phantom line
 third phantom
+export const w = 4;
`;
const p2: Proposal = { id: 'broken', file: 'a.ts', motive: 'broken', risk: 'low', diff: broken };
const r2 = checkProposalApplicability(p2, tmp);
t('broken diff → broken', r2.applicability === 'broken');
t('broken diff records error', !!r2.error && r2.error.length > 0);

// Case 3: new-file diff.
const newFileDiff = `--- /dev/null
+++ b/b.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;
const p3: Proposal = { id: 'newfile', file: 'b.ts', motive: 'new file', risk: 'low', diff: newFileDiff };
const r3 = checkProposalApplicability(p3, tmp);
t('new-file diff → ok', r3.applicability === 'ok');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
