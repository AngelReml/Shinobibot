// Habilidad B.2 — CLI integration for /committee.

import * as fs from 'fs';
import * as path from 'path';
import { Committee } from './Committee.js';
import { makeLLMClient } from '../reader/llm_adapter.js';

export async function runCommittee(reportPath: string): Promise<{ ok: boolean; outputPath: string }> {
  const abs = path.resolve(reportPath);
  if (!fs.existsSync(abs)) {
    console.log(`[committee] report not found: ${abs}`);
    return { ok: false, outputPath: '' };
  }
  const reportJson = fs.readFileSync(abs, 'utf-8');
  console.log(`[committee] target: ${abs}`);

  // Committee evolutivo: roles elegidos dinámicamente del catálogo de 7
  // según la relevancia a la tarea + peso por historial de votos.
  const committee = new Committee({
    llm: makeLLMClient(),
    evolutive: true,
    taskDescription: reportJson.slice(0, 4000),
  });
  console.log(`[committee] roles seleccionados (evolutivo): ${committee.activeRoles().join(', ')}`);
  const result = await committee.review(reportJson);

  // Persist
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'committee_reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${ts}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ source_report: abs, ...result }, null, 2));

  // Pretty-print
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMMITTEE REVIEW');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const m of result.members) {
    console.log('');
    if ('error' in m) {
      console.log(`[${m.role}] ERROR — ${m.error}`);
    } else {
      console.log(`[${m.role}]  risk=${m.risk_level}`);
      console.log('  strengths:');
      for (const s of m.strengths) console.log(`    + ${s}`);
      console.log('  weaknesses:');
      for (const w of m.weaknesses) console.log(`    - ${w}`);
      console.log('  recommendations:');
      for (const r of m.recommendations) console.log(`    → ${r}`);
    }
  }

  console.log('');
  console.log('───────────────────────────  SYNTHESIS  ───────────────────────');
  if ('error' in result.synthesis) {
    console.log(`SYNTHESIS FAILED: ${result.synthesis.error}`);
    console.log(`[committee] partial output: ${outputPath}`);
    return { ok: false, outputPath };
  }
  console.log(`overall_risk: ${result.synthesis.overall_risk}`);
  if (result.synthesis.mediator) {
    const m = result.synthesis.mediator;
    console.log(`mediator: ${m.finalRisk} (confianza ${m.confidence}) — ${m.rationale}`);
  }
  console.log('');
  console.log('CONSENSUS');
  if (result.synthesis.consensus.length === 0) console.log('  (none)');
  for (const c of result.synthesis.consensus) {
    console.log(`  • ${c.topic}  [${c.agreeing_roles.join(', ')}]`);
  }
  console.log('');
  console.log('DISSENTS');
  if (result.synthesis.dissents.length === 0) console.log('  (none — committee fully aligned, suspicious)');
  for (const d of result.synthesis.dissents) {
    console.log(`  ⚡ ${d.topic}`);
    for (const p of d.positions) console.log(`      [${p.role}] ${p.position}`);
  }
  console.log('');
  console.log('COMBINED RECOMMENDATIONS');
  for (const r of result.synthesis.combined_recommendations) console.log(`  → ${r}`);
  console.log('');
  console.log(`[committee] full output: ${outputPath}`);
  return { ok: true, outputPath };
}

export function parseCommitteeArgs(argv: string): { path?: string; error?: string } {
  const tokens = argv.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { error: 'Usage: /committee <report.json>  (defaults to last self_reports/ entry if omitted)' };
  }
  return { path: tokens[0] };
}

export function findLatestSelfReport(): string | undefined {
  const dir = path.join(process.cwd(), 'self_reports');
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return undefined;
  return path.join(dir, files[files.length - 1]);
}
