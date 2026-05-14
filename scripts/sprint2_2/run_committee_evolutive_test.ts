#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.2 — Committee voting evolutivo.
 *
 * Simulamos cinco "audits de complejidad alta" donde un committee
 * tradicional con 3 roles fijos (architect+security+ux) dudaría:
 *
 *   1. Tarea de performance puro: el committee tradicional pierde el
 *      contexto (no hay performance_analyst). El selector dinámico SÍ
 *      lo elige.
 *
 *   2. Tarea de schema/DB: el data_modeler debe estar.
 *
 *   3. Tarea de devops/CI: el devops_reviewer debe estar.
 *
 *   4. Dissent 3-vías (low/medium/high) sin mayoría: el mediator
 *      heurístico debe resolver via mediana ponderada.
 *
 *   5. Rol consistentemente fiable (alignment 90%, peso ~1.4) declara
 *      high; resto bajo: el mediator debe respetar el rol con peso
 *      alto sin requerir mayoría numérica.
 */

import { existsSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { selectRoles } from '../../src/committee/role_selector.js';
import { VoteHistory } from '../../src/committee/vote_history.js';
import { mediateHeuristic, votesFromMembers } from '../../src/committee/mediator.js';
import type { MemberReport } from '../../src/committee/Committee.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

function setupHistory(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sprint2_2-'));
  const path = join(dir, 'history.jsonl');
  process.env.SHINOBI_COMMITTEE_HISTORY_PATH = path;
  return { path, cleanup: () => { try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

async function main(): Promise<void> {
  console.log('=== Sprint 2.2 — Committee evolutivo ===');
  const { cleanup } = setupHistory();

  try {
    // ─── Escenario 1: Performance puro ─────────────────────────────────
    console.log('\n--- 1. Tarea de performance puro ---');
    const taskPerf = 'Optimiza el rendimiento del endpoint /search: latencia P99 > 2s, hay N+1 queries y blocking I/O. Memoria crece.';
    const selPerf = selectRoles(taskPerf, { count: 3 });
    console.log(`  selected: ${selPerf.map(r => r.id).join(', ')}`);
    check(selPerf.some(r => r.id === 'performance_analyst'), 'incluye performance_analyst');
    check(selPerf.some(r => r.id === 'architect') || selPerf.some(r => r.id === 'security_auditor'), 'mantiene cobertura core');

    // ─── Escenario 2: Schema/DB ─────────────────────────────────────────
    console.log('\n--- 2. Tarea de schema/migración ---');
    const taskDb = 'Diseña una migración del schema de la base de datos: añadir índices a las tablas users y orders, evaluar particionamiento.';
    const selDb = selectRoles(taskDb, { count: 3 });
    console.log(`  selected: ${selDb.map(r => r.id).join(', ')}`);
    check(selDb.some(r => r.id === 'data_modeler'), 'incluye data_modeler');

    // ─── Escenario 3: DevOps/CI ─────────────────────────────────────────
    console.log('\n--- 3. Tarea de pipeline CI/CD ---');
    const taskOps = 'Revisa nuestra pipeline de GitHub Actions: deploy a Kubernetes, monitoring con Prometheus, runbook de incident response.';
    const selOps = selectRoles(taskOps, { count: 3 });
    console.log(`  selected: ${selOps.map(r => r.id).join(', ')}`);
    check(selOps.some(r => r.id === 'devops_reviewer'), 'incluye devops_reviewer');

    // ─── Escenario 4: Dissent 3-vías sin mayoría ───────────────────────
    console.log('\n--- 4. Dissent 3-vías → mediator resuelve ---');
    const m4: MemberReport[] = [
      { role: 'architect',         strengths: [], weaknesses: ['módulo X frágil'], recommendations: [], risk_level: 'low' },
      { role: 'security_auditor',  strengths: [], weaknesses: ['eval(input)'],     recommendations: [], risk_level: 'high' },
      { role: 'design_critic',     strengths: [], weaknesses: ['naming confuso'],  recommendations: [], risk_level: 'medium' },
    ];
    const votes4 = votesFromMembers(m4); // todos peso 1.0 (sin historial)
    const r4 = mediateHeuristic(votes4);
    console.log(`  votes: ${votes4.map(v => `${v.roleId}=${v.risk}`).join(', ')}`);
    console.log(`  verdict: ${r4.finalRisk} (confidence=${r4.confidence}) · ${r4.rationale}`);
    check(['medium', 'high'].includes(r4.finalRisk), 'mediator produce un veredicto (medium o high)');
    check(r4.confidence !== 'high' || r4.finalRisk !== 'low', 'confidence calibrada en dissent puro');

    // ─── Escenario 5: Rol fiable con peso alto vence a la mayoría ──────
    console.log('\n--- 5. Rol fiable (peso 1.4) declara high, mayoría declara low ---');
    // Pre-pobla historial: security_auditor alineado 9/10 veces (peso ~1.4).
    const h = new VoteHistory();
    for (let i = 0; i < 9; i++) h.appendRecord({ reviewId: `pre${i}`, roleId: 'security_auditor', roleRisk: 'high', finalRisk: 'high', aligned: true });
    h.appendRecord({ reviewId: 'pre9', roleId: 'security_auditor', roleRisk: 'medium', finalRisk: 'high', aligned: false });
    const wSec = h.statsFor('security_auditor').weight;
    console.log(`  peso security_auditor tras historial: ${wSec.toFixed(2)}`);
    check(wSec >= 1.3, 'peso security_auditor ≥ 1.3');

    const m5: MemberReport[] = [
      { role: 'architect',         strengths: [], weaknesses: ['cosmético'], recommendations: [], risk_level: 'low' },
      { role: 'design_critic',     strengths: [], weaknesses: ['naming'],    recommendations: [], risk_level: 'low' },
      { role: 'security_auditor',  strengths: [], weaknesses: ['exfil curl con OPENAI_API_KEY'], recommendations: [], risk_level: 'high' },
    ];
    const weights = new Map<string, number>([
      ['architect', 1.0],
      ['design_critic', 1.0],
      ['security_auditor', wSec],
    ]);
    const votes5 = votesFromMembers(m5, weights);
    const r5 = mediateHeuristic(votes5);
    console.log(`  votes: ${votes5.map(v => `${v.roleId}=${v.risk}@${v.weight.toFixed(2)}`).join(', ')}`);
    console.log(`  verdict: ${r5.finalRisk} (confidence=${r5.confidence}) · ${r5.rationale}`);
    check(r5.finalRisk === 'high', 'mediator respeta rol con peso ≥1.3 declarando high pese a mayoría numérica low');
    check(r5.confidence === 'high', 'confidence high por regla 1');

    console.log('\n=== Summary ===');
    if (failed > 0) {
      console.log(`FAIL · ${failed} aserciones`);
      process.exit(1);
    }
    console.log('PASS · committee evolutivo selecciona roles dinámicos + pesos + mediator resuelve disensos');
  } finally {
    cleanup();
    delete process.env.SHINOBI_COMMITTEE_HISTORY_PATH;
  }
}

main().catch((e) => {
  console.error('Committee evolutive test crashed:', e?.stack ?? e);
  process.exit(2);
});
