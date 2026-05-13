#!/usr/bin/env node
/**
 * Shinobi Web — entry point para el chat (Bloque 1).
 *
 * Bloque 9: pkg-aware. Cuando se ejecuta como .exe empaquetado (process.pkg
 * definido), extrae public/ y chrome-win/ desde el snapshot a APPDATA en la
 * primera ejecución, ajusta PLAYWRIGHT_BROWSERS_PATH, y abre el navegador
 * automáticamente. En desarrollo (tsx) se comporta exactamente igual que
 * antes.
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

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

// pkg detection — process.pkg está definido cuando corremos como .exe empaquetado
const IS_PKG = typeof (process as any).pkg !== 'undefined';

// En dev, cargamos .env desde la raíz del proyecto. En pkg no hay .env;
// las env vars relevantes vienen de config.json (Bloque 7) o del shell.
if (!IS_PKG) {
  dotenvConfig({ path: resolve(__dirname, '../.env') });
}

// ─── Helpers para extracción en pkg mode ────────────────────────────────────

function appDataShinobi(): string {
  return path.join(process.env.APPDATA || process.env.HOME || '', 'Shinobi');
}

function copySnapshotTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copySnapshotTree(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

/**
 * En pkg mode, extrae public/ del snapshot a %APPDATA%/Shinobi/runtime/public.
 * Idempotente vía .version. Devuelve la ruta o null en dev.
 *
 * Chromium NO se embebe en el .exe (pesaría 400+ MB). Se distribuye como
 * carpeta hermana del .exe vía el Inno Setup installer — el .exe la busca
 * en `path.dirname(execPath)/playwright-browsers/` y exporta
 * PLAYWRIGHT_BROWSERS_PATH automáticamente.
 */
function ensureRuntimeExtracted(version: string): string | null {
  if (!IS_PKG) return null;
  const target = path.join(appDataShinobi(), 'runtime');
  const versionFile = path.join(target, '.version');

  let current = '';
  try { current = fs.readFileSync(versionFile, 'utf8').trim(); } catch { /* no existe */ }
  if (current === version && fs.existsSync(path.join(target, 'public'))) {
    return target;
  }

  console.log(`[Shinobi] Primera ejecución — extrayendo recursos a ${target}…`);
  const t0 = Date.now();
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  const snapshotPublic = path.join(__dirname, 'public');
  if (fs.existsSync(snapshotPublic)) {
    copySnapshotTree(snapshotPublic, path.join(target, 'public'));
  } else {
    console.log('[Shinobi] WARN: public/ no encontrado en el snapshot.');
  }

  fs.writeFileSync(versionFile, version);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[Shinobi] Recursos extraídos en ${dur}s.`);
  return target;
}

/**
 * Busca la carpeta playwright-browsers hermana del .exe. La pone el Inno
 * Setup installer. Si la encuentra, setea PLAYWRIGHT_BROWSERS_PATH para que
 * playwright la use. Sin ella, los skills de navegador no funcionarán.
 */
function configurePlaywrightBrowsers(): void {
  if (!IS_PKG) return;
  const execDir = path.dirname(process.execPath);
  const candidate = path.join(execDir, 'playwright-browsers');
  if (fs.existsSync(candidate)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = candidate;
    console.log(`[Shinobi] Playwright browsers: ${candidate}`);
  } else {
    console.log(`[Shinobi] playwright-browsers/ no encontrado junto al .exe. Skills de navegador deshabilitados.`);
  }
}

function openBrowser(url: string): void {
  // Windows: `start "" "url"` — comillas vacías son el title del cmd.
  exec(`start "" "${url}"`, (err) => {
    if (err) console.log(`[Shinobi] No se pudo abrir el navegador automáticamente: ${err.message}`);
  });
}

// ─── Boot ───────────────────────────────────────────────────────────────────

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

  // Bloque 9 — extracción de assets si somos .exe empaquetado
  // Versión hardcodeada para no depender de require('./package.json') en pkg.
  const APP_VERSION = '2.0.0';
  const runtimeDir = ensureRuntimeExtracted(APP_VERSION);
  let publicPath: string | undefined;
  if (runtimeDir) {
    publicPath = path.join(runtimeDir, 'public');
  }
  configurePlaywrightBrowsers();

  // Bloque 7 — config del usuario en APPDATA/Shinobi/config.json. Si no
  // existe, arrancamos igualmente con la pantalla de onboarding.
  const cfg = loadConfig();
  if (cfg) {
    process.env.OPENGRAVITY_URL = cfg.opengravity_url;
    process.env.SHINOBI_API_KEY = cfg.opengravity_api_key;
    process.env.SHINOBI_LANGUAGE = cfg.language;
    process.env.SHINOBI_MEMORY_PATH = cfg.memory_path;
    if (cfg.provider) process.env.SHINOBI_PROVIDER = cfg.provider;
    if (cfg.provider_key) process.env.SHINOBI_PROVIDER_KEY = cfg.provider_key;
    if (cfg.model_default) process.env.SHINOBI_MODEL_DEFAULT = cfg.model_default;
  } else {
    console.log('');
    console.log('────────────────────────────────────────────────────────────');
    console.log(' Shinobi sin config: arrancando con pantalla de onboarding.');
    console.log(' Abre http://localhost:3333 para elegir provider + key.');
    console.log('────────────────────────────────────────────────────────────');
    console.log('');
  }

  console.log('--- SHINOBIBOT WEB ---');
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

  try {
    const r = curatedMemory().loadAtBoot();
    console.log(`[Shinobi] Curated memory: ${r.userEntries} user entr(ies) (${r.userPct}%) | ${r.memoryEntries} env entr(ies) (${r.memoryPct}%).`);
    if (r.created.length) console.log(`[Shinobi] Plantillas creadas: ${r.created.join(', ')} — edítalos para personalizar.`);
  } catch (e: any) {
    console.log('[Shinobi] Curated memory error:', e?.message ?? e);
  }

  const port = Number(process.env.SHINOBI_WEB_PORT || 3333);
  // En pkg, la DB vive en APPDATA. En dev, junto al cwd como antes.
  const dbPath = IS_PKG
    ? path.join(appDataShinobi(), 'web_chat.db')
    : path.join(process.cwd(), 'web_chat.db');
  await startWebServer({ port, dbPath, publicPath });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  🟢 Shinobi corriendo en http://localhost:${port}`);
  console.log(`     Cierra esta ventana o pulsa Ctrl+C para detenerlo.`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Abrir navegador automáticamente — solo en pkg mode (el usuario hizo
  // doble-clic en el .exe; en dev usamos shinobi_web.cmd que abre el browser
  // por su lado).
  if (IS_PKG) {
    setTimeout(() => openBrowser(`http://localhost:${port}`), 800);
  }

  // Bloque 6 — Gateway externo (auto-activado si SHINOBI_GATEWAY_TOKEN está).
  const gatewayToken = process.env.SHINOBI_GATEWAY_TOKEN;
  if (gatewayToken) {
    const gPort = Number(process.env.SHINOBI_GATEWAY_PORT || 3334);
    const gHost = process.env.SHINOBI_GATEWAY_HOST || '0.0.0.0';
    const tgToken = process.env.SHINOBI_TELEGRAM_BOT_TOKEN;
    const tgAllowedIds = parseAllowedUserIds(process.env.SHINOBI_TELEGRAM_ALLOWED_USER_IDS);
    try {
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
  } else if (!IS_PKG) {
    console.log(`[gateway] disabled — set SHINOBI_GATEWAY_TOKEN to enable external HTTP + Telegram channels.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
