/**
 * Validación REAL del cableado de ghost features (3er ciclo):
 *   soul · observability dashboard · replay · telemetry · plugins.
 *
 * Ejercita las APIs reales que ahora tienen caller de producción.
 * Run: npx tsx scripts/audit_validation/p3_ghost_features_real.ts
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listBuiltinSouls, builtinSoul, personaSystemMessage } from '../../src/soul/soul.js';
import { renderDashboardHtml } from '../../src/observability/admin_dashboard.js';
import { summarize, formatSummary } from '../../src/replay/mission_replay.js';
import { emit } from '../../src/telemetry/telemetry.js';
import { loadAllPlugins } from '../../src/plugins/plugin_loader.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // soul — el orchestrator inyecta personaSystemMessage si SHINOBI_PERSONA.
  console.log('=== soul / persona ===');
  const souls = listBuiltinSouls();
  const first = souls[0];
  const soul = first ? builtinSoul(first) : null;
  const msg = soul ? personaSystemMessage(soul) : '';
  console.log(`  ${souls.length} personas built-in; primera='${first}'`);
  check('personaSystemMessage produce un system message no vacío', !!msg && msg.length > 10,
    `len=${msg.length}`);

  // observability — /admin/dashboard sirve renderDashboardHtml().
  console.log('\n=== observability dashboard ===');
  const dash = renderDashboardHtml();
  check('renderDashboardHtml devuelve HTML', /html/i.test(dash.contentType) && dash.body.length > 50,
    `contentType=${dash.contentType}, ${dash.body.length} bytes`);

  // replay — /replay resume el audit log.
  console.log('\n=== replay ===');
  const dir = mkdtempSync(join(tmpdir(), 'shinobi-replay-'));
  const auditLogPath = join(dir, 'audit.jsonl');
  writeFileSync(auditLogPath,
    '{"ts":"2026-05-17T10:00:00Z","type":"tool_call","tool":"run_command"}\n' +
    '{"ts":"2026-05-17T10:00:02Z","type":"tool_result","tool":"run_command","ok":true}\n', 'utf-8');
  const summary = summarize({ auditLogPath });
  const formatted = formatSummary(summary);
  console.log(`  summary: totalEvents=${summary.totalEvents}, toolCalls=${summary.toolCalls}`);
  check('summarize+formatSummary procesan el audit log', formatted.length > 0 && summary.totalEvents >= 2,
    `${summary.totalEvents} eventos, formato ${formatted.length} chars`);

  // telemetry — emit() es opt-in: sin opt-in NO envía.
  console.log('\n=== telemetry ===');
  const r = await emit('session_start', {}, { timeoutMs: 1500 });
  console.log(`  emit -> ${JSON.stringify(r)}`);
  check('emit() respeta el opt-out por defecto (no envía sin consentimiento)',
    r.sent === false, `sent=${r.sent}, reason=${r.reason}`);

  // plugins — loadAllPlugins corre sobre un dir real.
  console.log('\n=== plugins ===');
  const pluginsDir = mkdtempSync(join(tmpdir(), 'shinobi-plugins-'));
  const pr = await loadAllPlugins(pluginsDir);
  console.log(`  loadAllPlugins(dir vacío) -> loaded=${pr.loaded.length}, errors=${pr.errors.length}`);
  check('loadAllPlugins corre sin crash sobre un dir real', Array.isArray(pr.loaded) && Array.isArray(pr.errors),
    'devuelve LoadResult válido');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
