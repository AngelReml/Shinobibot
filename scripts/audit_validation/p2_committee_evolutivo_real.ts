/**
 * Validación REAL del committee evolutivo (P2).
 * Ejecuta una decisión REAL que pasa por el committee: roles elegidos
 * dinámicamente, miembros LLM reales votando, y el veredicto del mediador.
 * Hace llamadas LLM reales (autorizado).
 *
 * Run: npx tsx scripts/audit_validation/p2_committee_evolutivo_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

import { Committee } from '../../src/committee/Committee.js';
import { makeLLMClient } from '../../src/reader/llm_adapter.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // Report con problemas de seguridad Y de arquitectura Y de datos: el
  // role_selector debería elegir roles relevantes a esos ejes.
  const report = JSON.stringify({
    repo: 'shinobi-demo',
    summary: 'auditoria de seguridad y arquitectura de un repo con base de datos',
    modules: [
      { path: 'src/auth.ts', note: 'login: concatena SQL con input del usuario sin parametrizar (riesgo SQLi)' },
      { path: 'src/core/orchestrator.ts', note: 'modulo central con alto coupling, conoce 9 modulos' },
      { path: 'src/db/schema.ts', note: 'esquema SQLite sin migraciones versionadas' },
    ],
  });

  const committee = new Committee({ llm: makeLLMClient(), evolutive: true, taskDescription: report });
  const roles = committee.activeRoles();
  console.log(`\n=== Roles seleccionados dinamicamente ===\n  ${roles.join(', ')}`);
  check('selecciona roles del catalogo evolutivo', roles.length >= 3, `${roles.length} roles`);
  check('garantiza cobertura core (architect + security_auditor)',
    roles.includes('architect') && roles.includes('security_auditor'), roles.join(','));

  console.log('\n=== Ejecutando committee REAL (llamadas LLM) ... ===');
  const result = await committee.review(report);

  console.log('\n=== Votos de los miembros ===');
  let realVotes = 0;
  for (const m of result.members) {
    if ('error' in m) { console.log(`  [${m.role}] ERROR: ${m.error}`); }
    else { console.log(`  [${m.role}] risk_level=${m.risk_level}, ${m.weaknesses.length} weaknesses`); realVotes++; }
  }
  check('al menos 2 miembros produjeron un voto real', realVotes >= 2, `${realVotes} votos reales`);

  if ('error' in result.synthesis) {
    console.log(`\n[FAIL] sintesis fallo: ${result.synthesis.error}`);
    fail++;
  } else {
    const s = result.synthesis;
    console.log('\n=== Disensos ===');
    if (s.dissents.length === 0) console.log('  (sin disensos — miembros alineados)');
    for (const d of s.dissents) {
      console.log(`  DISENSO: ${d.topic}`);
      for (const p of d.positions) console.log(`    [${p.role}] ${p.position}`);
    }
    console.log('\n=== Veredicto del MEDIADOR (heuristico, evolutivo) ===');
    if (s.mediator) {
      const m = s.mediator;
      console.log(`  finalRisk=${m.finalRisk}  confianza=${m.confidence}  invokedLLM=${m.invokedLLM}`);
      console.log(`  rationale: ${m.rationale}`);
      console.log(`  tallies: ${JSON.stringify(m.votingTallies)}`);
    }
    check('el mediador emitio un veredicto', !!s.mediator && ['low', 'medium', 'high'].includes(s.mediator.finalRisk),
      `finalRisk=${s.mediator?.finalRisk}`);
    check('overall_risk refleja el veredicto del mediador',
      !!s.mediator && s.overall_risk === s.mediator.finalRisk, `overall=${s.overall_risk}`);
    check('registra los roles seleccionados con peso',
      Array.isArray(s.selected_roles) && s.selected_roles.length >= 3,
      `${s.selected_roles?.length ?? 0} roles con peso`);
  }

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
