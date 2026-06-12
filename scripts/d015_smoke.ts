/**
 * D-015 smoke test — drives ShinobiOrchestrator.process() directly (local mode).
 * Extirpación OG 2026-06-12: eliminado el health-check del kernel.
 */
import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';
import { loadConfig } from '../src/runtime/first_run_wizard.js';

async function main() {
  const config = loadConfig();
  if (!config) {
    console.error('[D015] No Shinobi config found. Run `shinobi` once interactively first.');
    process.exit(2);
  }
  if (config.provider) process.env.SHINOBI_PROVIDER = config.provider;
  if (config.provider_key) process.env.SHINOBI_PROVIDER_KEY = config.provider_key;

  const mission = process.argv[2] || 'Crea un archivo llamado test_d015.txt en el escritorio con el texto "hola D-015" y después léelo y muéstrame su contenido.';
  console.log(`[D015] Mission: ${mission}`);

  const t0 = Date.now();
  const result = await ShinobiOrchestrator.process(mission);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n=== D015 RESULT (${elapsed}s) ===`);
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error('[D015] Fatal:', e);
  process.exit(1);
});
