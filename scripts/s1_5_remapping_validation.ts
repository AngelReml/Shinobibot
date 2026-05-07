// S1.5 — validación remapping con audit DVWA. UNA corrida, sin voting.
// Captura output completo para docs/s1_5/remapping_validation.md.
import * as fs from 'fs';
import * as path from 'path';
import { Committee } from '../src/committee/Committee.js';
import { HierarchicalReader } from '../src/reader/HierarchicalReader.js';
import { makeLLMClient } from '../src/reader/llm_adapter.js';

// Wrapper que sobrescribe runAudit para forzar voting=1 sin tocar código fuente.
// Reusa la mayoría de runAudit pero elimina el voting=3 default.
import { spawnSync } from 'child_process';
import * as os from 'os';
import { MissionLedger } from '../src/ledger/MissionLedger.js';
import { KnowledgeRouter } from '../src/knowledge/KnowledgeRouter.js';
import { makeCodeReviewerRole } from '../src/committee/code_reviewer.js';
import { DEFAULT_ROLES } from '../src/committee/Committee.js';

async function main() {
  const url = 'https://github.com/digininja/DVWA';
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (!m) { console.error('bad url'); process.exit(1); }
  const owner = m[1], repo = m[2];

  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), `s1_5_remap_val_${owner}-${repo}-`));
  const t0 = Date.now();
  console.log(`[validation] cloning ${url}...`);
  const cl = spawnSync('git', ['clone', '--depth', '1', url, cloneRoot], { encoding: 'utf-8', stdio: 'inherit' });
  if (cl.status !== 0) { console.error('clone failed'); process.exit(1); }
  const headSha = (spawnSync('git', ['-C', cloneRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout || '').trim();
  console.log(`[validation] HEAD=${headSha}`);

  const outDir = path.join(process.cwd(), 'audits');
  const cacheMachineDir = path.join(outDir, '.machine');
  fs.mkdirSync(cacheMachineDir, { recursive: true });
  // Borrar cache para forzar lectura fresh
  for (const f of fs.readdirSync(cacheMachineDir)) {
    if (f.startsWith(headSha)) fs.unlinkSync(path.join(cacheMachineDir, f));
  }

  const missionId = `s1_5_remap_validation-${owner}-${repo}-${headSha.slice(0,8)}`;
  const router = new KnowledgeRouter({ knowledgeDir: path.join(process.cwd(), 'knowledge') });
  const knowledgeInjector = (taskText: string) => router.buildPromptInjection(taskText, missionId).text;

  console.log('[validation] HierarchicalReader depth=2 (defaults remapped)...');
  const reader = new HierarchicalReader({
    llm: makeLLMClient({ temperature: 0 }),
    depth: 2,
    missionId,
    knowledgeInjector,
    onProgress: (ev) => {
      if (ev.node && ['sub_supervisor_done', 'leaf_done', 'final_synth_done'].includes(ev.phase)) {
        console.log(`[validation] ${ev.phase} ${ev.node.label} (${ev.node.duration_ms}ms)`);
      }
    },
  });
  const readResult = await reader.read(cloneRoot);
  if (!readResult.ok || !readResult.report) { console.error('read failed'); process.exit(1); }

  console.log('[validation] Committee (voting=1, sin voting)...');
  const codeRole = makeCodeReviewerRole(cloneRoot);
  const roles = codeRole ? [...DEFAULT_ROLES, codeRole] : DEFAULT_ROLES;
  const committee = new Committee({
    llm: makeLLMClient({ temperature: 0 }),
    roles,
    votingRuns: 1,  // <- una sola corrida
    temperature: 0,
  });
  const cmt = await committee.review(JSON.stringify(readResult.report));

  const overallRisk = ('error' in cmt.synthesis)
    ? 'medium'
    : cmt.synthesis.overall_risk;
  const verdict = overallRisk === 'high' ? 'FAIL' : 'PASS';
  const dur = Date.now() - t0;

  // Persistir + extraer evidencia para el doc
  const machineFile = (s: string) => path.join(cacheMachineDir, `${headSha}_${s}.json`);
  fs.writeFileSync(machineFile('report'), JSON.stringify(readResult.report, null, 2));
  fs.writeFileSync(machineFile('subreports'), JSON.stringify(readResult.subreports, null, 2));
  fs.writeFileSync(machineFile('committee'), JSON.stringify({ members: cmt.members, synthesis: cmt.synthesis }, null, 2));
  fs.writeFileSync(machineFile('telemetry'), JSON.stringify(readResult.telemetry, null, 2));

  // Risk lines para validación criterio: "min 3 vulns con archivo:línea"
  const allRisks = readResult.report.risks.map(r => `[${r.severity.toUpperCase()}] ${r.description}`);
  const codeReviewer = cmt.members.find(mm => mm.role === 'code_reviewer');
  const cwWeaknesses = (codeReviewer && !('error' in codeReviewer)) ? codeReviewer.weaknesses : [];

  // Vulnerabilities con archivo:línea
  const fileLineRegex = /[a-zA-Z0-9_\-/]+\.(?:php|js|jsx|ts|tsx|sql|html|py|sh):\d+/;
  const vulnsWithFileLine = [...allRisks, ...cwWeaknesses].filter(s => fileLineRegex.test(s));

  console.log('');
  console.log('═══ S1.5 REMAPPING VALIDATION RESULT ═══');
  console.log(`repo:    ${owner}/${repo}@${headSha.slice(0,8)}`);
  console.log(`verdict: ${verdict}/${overallRisk}`);
  console.log(`vulns con archivo:línea: ${vulnsWithFileLine.length}`);
  console.log(`duracion: ${(dur/1000).toFixed(1)}s`);
  vulnsWithFileLine.slice(0, 5).forEach(v => console.log(`  - ${v.slice(0, 140)}`));

  // Cleanup clone
  try { fs.rmSync(cloneRoot, { recursive: true, force: true }); } catch {}

  // Persist results para el doc
  const validationDoc = path.join(process.cwd(), 'docs', 's1_5', 'remapping_validation_data.json');
  fs.mkdirSync(path.dirname(validationDoc), { recursive: true });
  fs.writeFileSync(validationDoc, JSON.stringify({
    repo: `${owner}/${repo}`,
    sha: headSha,
    verdict,
    overallRisk,
    durationMs: dur,
    risksCount: allRisks.length,
    codeReviewerWeaknessesCount: cwWeaknesses.length,
    vulnsWithFileLine,
    members: cmt.members.map(mm => 'error' in mm ? { role: mm.role, error: mm.error } : { role: mm.role, risk_level: mm.risk_level, weaknesses_count: mm.weaknesses.length }),
    synthesis: cmt.synthesis,
    report_purpose: readResult.report.repo_purpose,
    report_risks: allRisks,
    code_reviewer_weaknesses: cwWeaknesses,
  }, null, 2));
  console.log(`\n[validation] data: ${validationDoc}`);

  // Pass criterion: verdict FAIL/high + min 3 vulns con archivo:línea
  const ok = verdict === 'FAIL' && overallRisk === 'high' && vulnsWithFileLine.length >= 3;
  console.log(`\nCRITERIO: ${ok ? 'CUMPLE ✅' : 'NO CUMPLE ❌'} (verdict=${verdict}/${overallRisk}, vulns_archivo_linea=${vulnsWithFileLine.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
