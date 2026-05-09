#!/usr/bin/env node
/**
 * Shinobi Web — entry point for the Bloque 1 UI.
 *
 * Mirrors the bootstrap of scripts/shinobi.ts (config, env vars, kernel check,
 * approved-skills reload) but launches the Express+WebSocket server in
 * src/web/server.ts instead of an interactive readline REPL.
 *
 * The CLI is preserved unchanged at scripts/shinobi.ts. CLI and Web are
 * mutually exclusive per session — see docs/sessions/bloque1_ui_web.md.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { loadConfig } from '../src/runtime/first_run_wizard.js';
import { acquireLock, formatLockedError } from '../src/runtime/process_lock.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { SkillLoader } from '../src/skills/skill_loader.js';
import { startWebServer } from '../src/web/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../.env') });

async function checkKernel(): Promise<boolean> {
  const online = await KernelClient.isOnline();
  if (online) console.log('🟢 OpenGravity Kernel: ONLINE');
  else console.log('🟡 OpenGravity Kernel: OFFLINE (using local mode)');
  return online;
}

async function main() {
  // FAIL 3 — single-instance lock. CLI y Web son mutuamente exclusivos.
  const lock = acquireLock('shinobi-web');
  if (!lock.acquired) {
    console.error('');
    console.error(formatLockedError(lock));
    console.error('');
    process.exit(2);
  }

  const cfg = loadConfig();
  if (!cfg) {
    console.error('');
    console.error('────────────────────────────────────────────────────────────');
    console.error(' No Shinobi config found.');
    console.error(' Ejecuta "shinobi.cmd" una vez para completar el wizard de');
    console.error(' primer arranque y luego vuelve a abrir "shinobi_web.cmd".');
    console.error('────────────────────────────────────────────────────────────');
    console.error('');
    process.exit(2);
  }
  process.env.OPENGRAVITY_URL = cfg.opengravity_url;
  process.env.SHINOBI_API_KEY = cfg.opengravity_api_key;
  process.env.SHINOBI_LANGUAGE = cfg.language;
  process.env.SHINOBI_MEMORY_PATH = cfg.memory_path;

  console.log('--- SHINOBIBOT WEB UI (Bloque 1) ---');
  await checkKernel();

  // Reload approved skills on boot, same as the CLI.
  try {
    const r = await SkillLoader.reloadAllApproved();
    if (r.loaded > 0) console.log(`[Shinobi] Cargadas ${r.loaded} skill(s) aprobadas previamente.`);
    if (r.errors.length > 0) {
      console.log(`[Shinobi] ${r.errors.length} skill(s) fallaron al cargar:`);
      r.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills aprobadas:', e?.message ?? e);
  }

  const port = Number(process.env.SHINOBI_WEB_PORT || 3333);
  await startWebServer({ port });
  console.log(`[shinobi-web] UI ready — abre http://localhost:${port} en tu navegador.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
