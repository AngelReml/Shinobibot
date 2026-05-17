/**
 * Smoke de carga: importa los módulos de entrada de producción y verifica
 * que el grafo de módulos está intacto tras los 5 ciclos de auditoría
 * (sin imports rotos a código borrado, sin errores en tiempo de carga).
 *
 * Run: npx tsx scripts/audit_validation/p6_smoke.ts
 */
const mods = [
  '../../src/coordinator/orchestrator.js',
  '../../src/coordinator/slash_commands.js',
  '../../src/web/server.js',
  '../../src/channels/channels_wiring.js',
  '../../src/a2a/a2a_wiring.js',
  '../../src/skills/registry/install_command.js',
  '../../src/skills/skill_loader.js',
  '../../src/skills/skill_manager.js',
  '../../src/sandbox/browser_sandbox/wiring.js',
  '../../src/sandbox/registry.js',
  '../../src/reader/cli.js',
  '../../src/reader/RepoReader.js',
  '../../src/replay/mission_replay.js',
  '../../src/soul/soul.js',
  '../../src/telemetry/telemetry.js',
  '../../src/plugins/plugin_loader.js',
  '../../src/tools/index.js',
  '../../src/security/approval.js',
  '../../src/db/memory.js',
  '../../src/memory/memory_store.js',
  '../../src/memory/memory_citations.js',
  '../../src/memory/dreaming/dreaming_wiring.js',
  '../../src/runtime/resident_loop.js',
  '../../src/updater/install_update.js',
  '../../src/coordinator/model_router.js',
  '../../src/cloud/opengravity_client.js',
];

async function main() {
  let ok = 0, bad = 0;
  for (const m of mods) {
    try { await import(m); ok++; }
    catch (e: any) { bad++; console.log(`[BROKEN] ${m} -> ${e?.message ?? e}`); }
  }
  console.log(`\nRESULTADO smoke: ${ok}/${mods.length} módulos de producción cargan` +
    (bad ? `  | ${bad} IMPORTS ROTOS` : '  — grafo de módulos intacto, sin imports rotos'));
  process.exit(bad ? 1 : 0);
}
main();
