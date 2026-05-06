// F2 — code_reviewer file selection + blob construction (no LLM).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickRiskyFiles, buildCodeReviewBlob, makeCodeReviewerRole, CODE_REVIEWER_MAX_CHARS } from '../code_reviewer.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
fs.writeFileSync(path.join(root, 'README.md'), '# x\n');
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(path.join(root, 'src', 'login.php'), '<?php $u = $_POST["u"]; mysqli_query($conn, "SELECT * FROM users WHERE name=$u"); ?>');
fs.writeFileSync(path.join(root, 'src', 'utils.ts'), 'export function add(a, b) { return a + b; }');
fs.writeFileSync(path.join(root, 'src', 'auth.js'), 'function checkPassword(p) { return p === "admin123"; }');
fs.writeFileSync(path.join(root, 'src', 'render.html'), '<html><script>document.write(location.hash)</script></html>');
fs.mkdirSync(path.join(root, 'node_modules'));
fs.writeFileSync(path.join(root, 'node_modules', 'leak.js'), 'should be ignored');
fs.mkdirSync(path.join(root, 'docs'));
fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# guide\n');

console.log('F2 — pickRiskyFiles');
const picks = pickRiskyFiles(root);
t('returns array sorted by risk score desc', picks.length > 0 && picks.every((p, i, a) => i === 0 || a[i - 1].score >= p.score));
t('login.php in top picks (auth + .php)', picks.slice(0, 3).some((p) => p.rel === 'src/login.php'));
t('auth.js scored high', picks.find((p) => p.rel === 'src/auth.js')!.score >= 6);
t('utils.ts present but lower priority', picks.find((p) => p.rel === 'src/utils.ts') !== undefined);
t('node_modules excluded', !picks.some((p) => p.rel.startsWith('node_modules')));
t('docs/*.md NOT picked (not risky ext)', !picks.some((p) => p.rel.endsWith('.md')));

console.log('\nF2 — buildCodeReviewBlob');
const { blob, files } = buildCodeReviewBlob(root);
t('blob non-empty', blob.length > 0);
t('blob respects char cap', blob.length <= CODE_REVIEWER_MAX_CHARS);
t('blob references login.php content', /mysqli_query/.test(blob));
t('blob lists files used', files.includes('src/login.php'));

console.log('\nF2 — makeCodeReviewerRole');
const role = makeCodeReviewerRole(root);
t('role exists for risky repo', role !== undefined);
if (role) {
  t('role.role = code_reviewer', role.role === 'code_reviewer');
  t('role.systemPrompt mentions SQLi / XSS / path traversal', /SQL injection/.test(role.systemPrompt) && /XSS/.test(role.systemPrompt) && /Path traversal/i.test(role.systemPrompt));
  t('role.systemPrompt cites at least one risky file', /login\.php/.test(role.systemPrompt));
}

console.log('\nF2 — repo without risky files returns undefined');
const safe = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-safe-'));
fs.writeFileSync(path.join(safe, 'README.md'), '# only docs\n');
const noRole = makeCodeReviewerRole(safe);
t('no risky files → role undefined', noRole === undefined);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(safe, { recursive: true, force: true });

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
