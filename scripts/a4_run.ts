// A.4 runner — invoca el MISMO flujo que /read (runRead) sobre los 2 repos.
// Vuelca los reports crudos en docs/A4_VALIDATION.md sin evaluar.
import * as fs from 'fs';
import * as path from 'path';
import { runRead } from '../src/reader/cli.js';

const TARGETS = [
  { label: 'opengravity', name: 'OpenGravity', path: 'C:\\Users\\angel\\Desktop\\OpenGravity' },
  { label: 'execa', name: 'execa', path: 'C:\\Users\\angel\\Desktop\\test_repos\\execa' },
];

async function main() {
  const dumps: { name: string; missionDir: string; durationMs: number; ok: boolean; report?: any; subreports?: any }[] = [];

  for (const t of TARGETS) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`A.4 — /read ${t.path}`);
    console.log('═══════════════════════════════════════════════════════════════');
    const r = await runRead(t.path, { label: `a4_${t.label}` });
    let report: any, subreports: any;
    if (r.ok && r.missionDir) {
      try { report = JSON.parse(fs.readFileSync(path.join(r.missionDir, 'report.json'), 'utf-8')); } catch { /* none */ }
      try { subreports = JSON.parse(fs.readFileSync(path.join(r.missionDir, 'subreports.json'), 'utf-8')); } catch { /* none */ }
    }
    dumps.push({ name: t.name, missionDir: r.missionDir, durationMs: r.durationMs, ok: r.ok, report, subreports });
  }

  // Append raw dumps to docs/A4_VALIDATION.md without evaluating.
  const docPath = path.join(process.cwd(), 'docs', 'A4_VALIDATION.md');
  const original = fs.readFileSync(docPath, 'utf-8');
  const ts = new Date().toISOString();

  let appendix = `\n\n---\n\n## RAW DUMPS — ejecutado ${ts}\n`;
  appendix += `\n> Reports crudos volcados por scripts/a4_run.ts. Pendiente evaluación humana C/I/R.\n`;

  for (const d of dumps) {
    appendix += `\n### Repo: ${d.name}\n`;
    appendix += `- mission_dir: \`${d.missionDir}\`\n`;
    appendix += `- duration_ms: ${d.durationMs}\n`;
    appendix += `- ok: ${d.ok}\n\n`;
    appendix += `#### report.json\n\n\`\`\`json\n${d.report ? JSON.stringify(d.report, null, 2) : '(no report — run failed)'}\n\`\`\`\n\n`;
    appendix += `#### subreports.json\n\n\`\`\`json\n${d.subreports ? JSON.stringify(d.subreports, null, 2) : '(no subreports)'}\n\`\`\`\n`;
  }

  fs.writeFileSync(docPath, original + appendix, 'utf-8');
  console.log('');
  console.log(`[a4_run] dumps añadidos a ${docPath}`);
}

main().catch((e) => { console.error('[a4_run] FATAL:', e); process.exit(1); });
