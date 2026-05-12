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

import * as path from 'path';
import { loadConfig } from '../src/runtime/first_run_wizard.js';
import { acquireLock, formatLockedError } from '../src/runtime/process_lock.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { SkillLoader } from '../src/skills/skill_loader.js';
import { skillManager } from '../src/skills/skill_manager.js';
import { curatedMemory } from '../src/memory/curated_memory.js';
import { startWebServer } from '../src/web/server.js';
import { ChatStore } from '../src/web/chat_store.js';
import { startGateway, parseAllowedUserIds } from '../src/gateway/index.js';
import { lanWebChatInfo } from '../src/gateway/webchat_channel.js';

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
    if (r.loaded > 0) console.log(`[Shinobi] Cargadas ${r.loaded} skill(s) ejecutables aprobadas previamente.`);
    if (r.errors.length > 0) {
      console.log(`[Shinobi] ${r.errors.length} skill(s) fallaron al cargar:`);
      r.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills aprobadas:', e?.message ?? e);
  }

  // Bloque 3 — Auto-load approved markdown skills.
  try {
    const md = skillManager().loadApproved();
    if (md.count > 0) console.log(`[Shinobi] Cargadas ${md.count} skill(s) markdown aprobadas previamente.`);
    if (md.errors.length > 0) {
      console.log(`[Shinobi] ${md.errors.length} skill(s) markdown fallaron al cargar:`);
      md.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills markdown:', e?.message ?? e);
  }

  // Bloque 4 — Curated memory snapshot (USER.md + MEMORY.md).
  try {
    const r = curatedMemory().loadAtBoot();
    console.log(`[Shinobi] Curated memory: ${r.userEntries} user entr(ies) (${r.userPct}%) | ${r.memoryEntries} env entr(ies) (${r.memoryPct}%).`);
    if (r.created.length) console.log(`[Shinobi] Plantillas creadas: ${r.created.join(', ')} — edítalos para personalizar.`);
  } catch (e: any) {
    console.log('[Shinobi] Curated memory error:', e?.message ?? e);
  }

  const port = Number(process.env.SHINOBI_WEB_PORT || 3333);
  const dbPath = path.join(process.cwd(), 'web_chat.db');
  await startWebServer({ port, dbPath });

  // ─── Boot log (decision G) — clarity inmediata de dónde está accesible ─
  console.log('');
  console.log(`[shinobi-web] Web UI local: http://localhost:${port}`);

  // Bloque 6 — Gateway externo (auto-activado si SHINOBI_GATEWAY_TOKEN está).
  const gatewayToken = process.env.SHINOBI_GATEWAY_TOKEN;
  if (gatewayToken) {
    const gPort = Number(process.env.SHINOBI_GATEWAY_PORT || 3334);
    const gHost = process.env.SHINOBI_GATEWAY_HOST || '0.0.0.0';
    const tgToken = process.env.SHINOBI_TELEGRAM_BOT_TOKEN;
    const tgAllowedIds = parseAllowedUserIds(process.env.SHINOBI_TELEGRAM_ALLOWED_USER_IDS);
    try {
      // Gateway reuses the same chat_store.db file. WAL mode permits the
      // multiple connections (one per ChatStore instance).
      const gatewayStore = new ChatStore(dbPath);
      const gw = await startGateway({
        port: gPort,
        host: gHost,
        token: gatewayToken,
        chatStore: gatewayStore,
        webLocalPort: port,
        telegram: tgToken && tgAllowedIds.length > 0 ? {
          botToken: tgToken,
          allowedUserIds: tgAllowedIds,
        } : undefined,
      });
      console.log(`[gateway] HTTP REST: http://${gHost === '0.0.0.0' ? 'localhost' : gHost}:${gPort} (token-gated)`);
      console.log(`[gateway] ${lanWebChatInfo(port)}`);
      if (gw.telegram) {
        const tgName = gw.telegram.username ? '@' + gw.telegram.username : '(unknown)';
        console.log(`[gateway] Telegram bot: ${tgName} (allowlist: ${tgAllowedIds.length} user${tgAllowedIds.length === 1 ? '' : 's'})`);
      } else if (tgToken && tgAllowedIds.length === 0) {
        console.log(`[gateway] Telegram bot: NOT started — SHINOBI_TELEGRAM_ALLOWED_USER_IDS is empty.`);
      }
    } catch (e: any) {
      console.log(`[gateway] startup failed: ${e?.message ?? e}`);
    }
  } else {
    console.log(`[gateway] disabled — set SHINOBI_GATEWAY_TOKEN to enable external HTTP + Telegram channels.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
