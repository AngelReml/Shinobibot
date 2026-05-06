// F2 gate — audit DVWA con code_reviewer activado.
// Espera que mencione SQL injection / XSS / file upload / command injection.
import * as fs from 'fs';
import * as path from 'path';
import { runAudit } from '../src/audit/runAudit.js';

async function main() {
  console.log('F2 gate — audit DVWA con code_reviewer');
  // Clear any stale cache for DVWA so the audit runs fresh.
  const machineDir = path.join(process.cwd(), 'audits', '.machine');
  if (fs.existsSync(machineDir)) {
    for (const f of fs.readdirSync(machineDir)) {
      // DVWA HEAD changes; we'll wipe everything that mentions DVWA in the md filenames.
    }
  }
  const r = await runAudit({ url: 'https://github.com/digininja/DVWA' });
  if (!r.ok) { console.error('audit failed'); process.exit(1); }

  // Inspect the committee.json for the new code_reviewer entry.
  const cmtPath = path.join(machineDir, `${r.sha}_committee.json`);
  const cmt = JSON.parse(fs.readFileSync(cmtPath, 'utf-8'));
  const codeReviewer = (cmt.members || []).find((m: any) => m.role === 'code_reviewer');
  const text = JSON.stringify(cmt).toLowerCase();
  const securitySignals = ['sql injection', 'sqli', 'xss', 'cross-site scripting', 'csrf', 'file upload', 'command injection', 'path traversal', 'rce', 'eval', 'shell'];
  const found = securitySignals.filter((s) => text.includes(s));
  const md = fs.readFileSync(r.mdPath, 'utf-8').toLowerCase();
  const mdSignals = securitySignals.filter((s) => md.includes(s));

  console.log('');
  console.log('═══ F2 GATE RESULT ═══');
  console.log(`code_reviewer present:  ${codeReviewer ? 'YES' : 'NO'}`);
  console.log(`signals in committee:   [${found.join(', ')}]`);
  console.log(`signals in audit md:    [${mdSignals.join(', ')}]`);
  console.log(`verdict:                ${r.verdict}/${r.overallRisk}`);
  const pass = found.length >= 1;
  console.log(`gate:                   ${pass ? 'VERDE ✅' : 'ROJO ❌'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
