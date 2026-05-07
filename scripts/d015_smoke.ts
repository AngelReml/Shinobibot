/**
 * D-015 smoke test — drives ShinobiOrchestrator.process() against the unified
 * OpenGravity kernel without entering the interactive readline CLI. Used to
 * verify end-to-end (Shinobi → kernel → LLM → tools → result) after the
 * gateway/index.ts unification.
 */
import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { loadConfig } from '../src/runtime/first_run_wizard.js';

async function main() {
  const config = loadConfig();
  if (!config) {
    console.error('[D015] No Shinobi config found. Run `shinobi` once interactively first.');
    process.exit(2);
  }
  process.env.OPENGRAVITY_URL = config.opengravity_url;
  process.env.SHINOBI_API_KEY = config.opengravity_api_key;

  console.log(`[D015] OPENGRAVITY_URL=${config.opengravity_url}`);
  console.log(`[D015] SHINOBI_API_KEY len=${(config.opengravity_api_key || '').length}`);

  const online = await KernelClient.isOnline();
  console.log(`[D015] Kernel /health → ${online ? 'ONLINE' : 'OFFLINE'}`);
  if (!online) process.exit(3);

  const mission = process.argv[2] || 'Crea un archivo llamado test_d015.txt en el escritorio del usuario con el texto "hola D-015 unificado" y después léelo y muéstrame su contenido.';
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
