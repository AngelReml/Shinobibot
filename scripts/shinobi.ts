#!/usr/bin/env node
/**
 * Shinobi CLI v5 - Connected to OpenGravity Kernel
 */

import * as readline from 'readline';
import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';
import { handleSlashCommand } from '../src/coordinator/slash_commands.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { SkillLoader } from '../src/skills/skill_loader.js';
import { skillManager } from '../src/skills/skill_manager.js';
import { ResidentLoop } from '../src/runtime/resident_loop.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { configExists, loadConfig, runFirstRunWizard } from '../src/runtime/first_run_wizard.js';
import { acquireLock, formatLockedError } from '../src/runtime/process_lock.js';
import {
  ensureApprovalModeInitialized,
  setApprovalAsker,
  type Approval,
} from '../src/security/approval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env') });

async function checkKernel(): Promise<boolean> {
  const online = await KernelClient.isOnline();
  if (online) {
    console.log('🟢 OpenGravity Kernel: ONLINE');
  } else {
    console.log('🟡 OpenGravity Kernel: OFFLINE (using local mode)');
    console.log('   To enable kernel: run "kernel.cmd" in OpenGravity folder');
  }
  return online;
}

async function maybeRunOneShotCommand(): Promise<boolean> {
  const argv = process.argv.slice(2);

  // D.3 — `shinobi audit <github_url> [--commit=SHA] [--budget=N]` one-shot.
  if (argv[0] === 'audit') {
    const { runAudit, parseAuditCliArgs } = await import('../src/audit/runAudit.js');
    const parsed = parseAuditCliArgs(argv);
    if (parsed.error) { console.error('Error:', parsed.error); console.error('Usage: shinobi audit <github_url> [--commit=SHA] [--budget=N]'); process.exit(2); }
    const r = await runAudit({ url: parsed.url!, commit: parsed.commit, budgetTokens: parsed.budgetTokens });
    process.exit(r.contractPass ? 0 : 1);
  }

  if (argv[0] === 'import' && argv[1] === 'hermes') {
    const dryRun = !argv.includes('--overwrite') || argv.includes('--dry-run');
    const overwrite = argv.includes('--overwrite');
    const hermesIdx = argv.indexOf('--hermes-root');
    const hermesRoot = hermesIdx >= 0 ? argv[hermesIdx + 1] : undefined;
    const shinobiIdx = argv.indexOf('--shinobi-dir');
    const shinobiDir = shinobiIdx >= 0 ? argv[shinobiIdx + 1] : undefined;
    const repoIdx = argv.indexOf('--repo-dir');
    const repoDir = repoIdx >= 0 ? argv[repoIdx + 1] : undefined;
    const { applyImport, renderPlan } = await import('../src/migration/from_hermes.js');
    const result = await applyImport({ dryRun, overwrite, hermesRootOverride: hermesRoot, shinobiDirOverride: shinobiDir, shinobiRepoOverride: repoDir });
    console.log(renderPlan(result.plan));
    console.log('');
    console.log(`mode    : ${dryRun ? 'dry-run' : 'apply'}`);
    console.log(`applied : ${result.applied}`);
    if (result.errors.length) {
      console.log('errors  :');
      for (const e of result.errors) console.log('  -', e);
    }
    process.exit(result.errors.length ? 1 : 0);
  }

  // H4 — one-shot demo of a single ShinobiBench task with auto-recording.
  // C7 — `shinobi demo --task killer` short-circuits to the killer demo runner.
  if (argv[0] === 'demo') {
    const taskIdx = argv.indexOf('--task');
    const task_id = taskIdx >= 0 ? argv[taskIdx + 1] : undefined;
    // Opt-IN: OBS recording only when --record is explicit. --no-record kept for back-compat (no-op).
    const record = argv.includes('--record');
    if (!task_id) {
      console.error('Usage: shinobi demo --task <T01..T30 | killer> [--record]');
      process.exit(2);
    }
    if (task_id === 'killer') {
      const path = await import('node:path');
      const { spawn } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const __scriptsDir = path.dirname(fileURLToPath(import.meta.url));
      const runnerPath = path.resolve(__scriptsDir, '..', 'demos', 'killer_demo_runner.mjs');
      let recStarted = false;
      if (record) {
        try {
          const recMod: any = await import('../skills/desktop/desktop-obs-record-self/scripts/skill.mjs');
          const r = await recMod.default.execute({ scene: 'Shinobi Killer Demo', auto_launch: true });
          if (r.success) { console.log('[killer] OBS recording started (--record)'); recStarted = true; }
          else console.log('[killer] OBS recording skipped:', r.error);
        } catch (e: any) { console.log('[killer] OBS skipped:', e?.message ?? e); }
      } else {
        console.log('[killer] OBS recording: off (default — pass --record to enable)');
      }
      const child = spawn('node', [runnerPath], { stdio: 'inherit' });
      const exitCode: number = await new Promise((r) => child.once('exit', (c) => r(c ?? 1)));
      if (recStarted) {
        try {
          const stopMod: any = await import('../skills/desktop/desktop-obs-stop-and-save/scripts/skill.mjs');
          const r = await stopMod.default.execute({});
          if (r.success) console.log('[killer] OBS stopped:', JSON.parse(r.output).output_path);
          else console.log('[killer] OBS stop error:', r.error);
        } catch (e: any) { console.log('[killer] OBS stop failed:', e?.message ?? e); }
      }
      process.exit(exitCode);
    }
    const { runDemo } = await import('../src/demo/demo_runner.js');
    const r = await runDemo({ task_id, record });
    console.log('\n=== demo summary ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }

  // H5 — full self-improvement demo with optional OBS bracketing.
  if (argv[0] === 'run-demo' && argv[1] === 'full-self-improve') {
    const record = argv.includes('--record');
    const { runDemo } = await import('../src/demo/demo_runner.js');
    const r = await runDemo({ fullSelfImprove: true, record });
    console.log('\n=== run-demo summary ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }

  // 24/7 resident mode — `shinobi daemon`. Headless: no REPL, just the
  // ResidentLoop ticking forever. Designed to be wrapped by a Windows service
  // (see scripts/install_service.ps1) for production use.
  if (argv[0] === 'daemon') {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('No Shinobi config found. Run `shinobi` once interactively to onboard before launching daemon.');
      process.exit(2);
    }
    process.env.OPENGRAVITY_URL = cfg.opengravity_url;
    process.env.SHINOBI_API_KEY = cfg.opengravity_api_key;
    process.env.SHINOBI_LANGUAGE = cfg.language;
    process.env.SHINOBI_MEMORY_PATH = cfg.memory_path;

    // D-017 — daemon mode: ensure approval_mode initialized. Default asker
    // denies destructive ops (no interactive prompt in daemon).
    const approvalInit = ensureApprovalModeInitialized();
    console.log(`[shinobi-daemon] approval mode: ${approvalInit.mode}${approvalInit.created ? ' (default)' : ''}`);

    const { ResidentLoop } = await import('../src/runtime/resident_loop.js');
    const loop = new ResidentLoop();
    loop.start();
    console.log(`[shinobi-daemon] resident loop started — pid=${process.pid}`);

    let stopping = false;
    const shutdown = (sig: string) => {
      if (stopping) return;
      stopping = true;
      console.log(`[shinobi-daemon] ${sig} received — stopping loop`);
      try { loop.stop(); } catch { }
      // Give pending ticks 2 seconds to wind down
      setTimeout(() => process.exit(0), 2000);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Heartbeat every 5 minutes so logs prove the daemon is alive
    setInterval(() => {
      console.log(`[shinobi-daemon] heartbeat ${new Date().toISOString()} pid=${process.pid}`);
    }, 5 * 60 * 1000).unref?.();
    return true; // keep the process alive
  }

  // G2 — `shinobi telemetry [on|off|status]`
  if (argv[0] === 'telemetry') {
    const sub = argv[1] ?? 'status';
    const tel = await import('../src/telemetry/telemetry.js');
    if (sub === 'on') {
      const cfg = tel.setOptIn(true);
      console.log(`telemetry: ON  (anonymous_id=${cfg.anonymous_id.slice(0, 8)}…)`);
      process.exit(0);
    }
    if (sub === 'off') {
      tel.setOptIn(false);
      console.log('telemetry: OFF');
      process.exit(0);
    }
    if (sub === 'status') {
      const s = tel.summary();
      console.log(JSON.stringify(s, null, 2));
      process.exit(0);
    }
    console.error('Usage: shinobi telemetry [on|off|status]');
    process.exit(2);
  }

  // B2.4/B2.5 — `shinobi update [--check] [--dry-run]`
  if (argv[0] === 'update') {
    const { checkForUpdate, renderOffer } = await import('../src/updater/version_check.js');
    const checkOnly = argv.includes('--check');
    const dryRun = argv.includes('--dry-run');
    const offer = await checkForUpdate();
    if (!offer) { console.log('Already on the latest version (or kernel unreachable).'); process.exit(0); }
    console.log(renderOffer(offer));
    if (checkOnly) process.exit(0);
    const { fetchAndInstall } = await import('../src/updater/install_update.js');
    const r = await fetchAndInstall({ verbose: true, dryRun });
    console.log('\n=== update summary ===');
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exit(1);
    if (!dryRun) {
      console.log('Installer launched. This Shinobi process will exit in 2s so the new install can replace files.');
      setTimeout(() => process.exit(0), 2000);
      return true;
    }
    process.exit(0);
  }

  return false;
}

async function main() {
  if (await maybeRunOneShotCommand()) return;

  // FAIL 3 — single-instance lock. CLI y Web son mutuamente exclusivos.
  const lock = acquireLock('shinobi-cli');
  if (!lock.acquired) {
    console.error('');
    console.error(formatLockedError(lock));
    console.error('');
    process.exit(2);
  }

  let config = loadConfig();
  if (!config) {
    config = await runFirstRunWizard();
  }
  process.env.OPENGRAVITY_URL = config.opengravity_url;
  process.env.SHINOBI_API_KEY = config.opengravity_api_key;
  process.env.SHINOBI_LANGUAGE = config.language;
  process.env.SHINOBI_MEMORY_PATH = config.memory_path;

  console.log('\n--- SHINOBIBOT CLI V5 (KERNEL CONNECTED) ---');
  console.log('Escribe tu orden o "exit" para salir.');
  console.log('Comandos especiales:');
  console.log('  /mode local  - Forzar modo local');
  console.log('  /mode kernel - Forzar modo kernel');
  console.log('  /mode auto   - Modo automático (default)');
  console.log('  /status      - Ver estado del kernel');
  console.log('  /model       - Ver o cambiar modelo LLM (/model <nombre> | auto | list)');
  console.log('  /tier        - Forzar tier (/tier fast | balanced | reasoning | auto)');
  console.log('  /memory      - Gestionar memoria (/memory recall <q> | store <txt> | stats | forget <id>)');
  console.log('  /skill       - Gestionar skills (/skill list | approve <id> | list-approved | reload)');
  console.log('  /resident    - Misiones recurrentes (/resident start|stop|status|add|enable|disable|delete|reset|logs)');
  console.log('  /notify      - Notificaciones (/notify set <workflow_id> | unset | test)');
  console.log('  /record      - Auto-grabar sesion en OBS (/record start | /record stop)');
  console.log('  /approval    - Modo de aprobación (/approval [on|smart|off])');
  console.log('  /read        - Lectura jerárquica de un repo (/read <ruta> [--budget=N])');
  console.log('  /self        - Auto-lectura del repo Shinobi (/self [--diff] [--budget=N])');
  console.log('  /committee   - Comité de validación sobre un report (/committee [<report.json>])');
  console.log('  /improvements - Genera propuestas a partir del último comité (markdown + json)');
  console.log('  /apply       - Aplica una propuesta tras confirmación humana (/apply <id>)');
  console.log('  /learn       - Aprende un programa nuevo (/learn <ruta | github URL | docs URL>)');
  console.log('  /ledger      - Hash chain de misiones (/ledger verify | /ledger export)');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // D-017 — ensure approval_mode field exists in config; default 'smart' if absent.
  const approvalInit = ensureApprovalModeInitialized();
  console.log(`[Shinobi] Approval mode: ${approvalInit.mode}`);

  // Wire the asker so the orchestrator can prompt the user via this rl.
  setApprovalAsker((promptText: string): Promise<Approval> => {
    return new Promise<Approval>((resolveAns) => {
      rl.question(promptText, (ans: string) => {
        const a = (ans || '').trim().toLowerCase();
        if (a === 'a' || a === 'always') resolveAns('always');
        else if (a === 'y' || a === 'yes' || a === 's' || a === 'si') resolveAns('yes');
        else resolveAns('no');
      });
    });
  });

  const residentLoop = new ResidentLoop();

  await checkKernel();

  // A5 — surface any pending upstream notice + start 24h watcher in the background.
  try {
    const watcher = await import('../src/watchers/hermes_watcher.js');
    const pending = watcher.popPendingNotice();
    if (pending) console.log(watcher.renderNotice(pending));
    watcher.startWatcher();
  } catch (e: any) {
    console.log('[hermes-watcher] disabled:', e?.message ?? e);
  }

  // B2.2/B2.3 — non-blocking update check on startup. Banner only; user runs `shinobi update` to apply.
  void (async () => {
    try {
      const { checkForUpdate, renderOffer } = await import('../src/updater/version_check.js');
      const offer = await checkForUpdate();
      if (offer) console.log(renderOffer(offer));
    } catch { /* silent */ }
  })();

  // Auto-reload previously approved skills (executable .mjs from OpenGravity)
  try {
    const r = await SkillLoader.reloadAllApproved();
    if (r.loaded > 0) console.log(`[Shinobi] Cargadas ${r.loaded} skill(s) ejecutables aprobadas previamente.`);
    if (r.errors.length > 0) {
      console.log(`[Shinobi] ${r.errors.length} skill(s) fallaron al cargar:`);
      r.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills aprobadas:', e.message);
  }

  // Bloque 3 — Auto-load approved markdown skills (SKILL.md prompts)
  try {
    const md = skillManager().loadApproved();
    if (md.count > 0) console.log(`[Shinobi] Cargadas ${md.count} skill(s) markdown aprobadas previamente.`);
    if (md.errors.length > 0) {
      console.log(`[Shinobi] ${md.errors.length} skill(s) markdown fallaron al cargar:`);
      md.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills markdown:', e.message);
  }

  console.log('');

  const prompt = () => {
    rl.setPrompt('Shinobi > ');
    rl.prompt();
  };

  const askViaRl = (q: string): Promise<string> =>
    new Promise<string>((res) => rl.question(q, (a) => res(a)));

  const handleInput = async (input: string): Promise<void> => {
    const trimmed = input.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'exit') {
      console.log('Hasta luego.');
      rl.close();
      process.exit(0);
    }

    // Slash commands extracted to src/coordinator/slash_commands.ts (Bloque 1).
    // Shared with src/web/server.ts so CLI and Web stay in lockstep.
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed, {
        residentLoop,
        ask: askViaRl,
      });
      if (handled) {
        prompt();
        return;
      }
      // Unrecognised slash → fall through to orchestrator (legacy behaviour).
    }

    // Process request
    console.log('[Engine procesando...]');

    try {
      const result = await ShinobiOrchestrator.process(trimmed);
      if (result && (result as any).output) {
        console.log('\n--- FINAL MISSION OUTPUT ---');
        console.log((result as any).output);
        console.log('----------------------------\n');
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error('Error:', err.message);
    }

    prompt();
  };

  // Paste detection: cuando se pega texto multilínea, readline emite un
  // 'line' event por cada \n en rapidísima sucesión. Sin buffer, solo la
  // primera línea alcanzaba al orchestrator y el resto se perdía
  // (rl.question() es one-shot). Esperamos PASTE_WINDOW_MS de silencio
  // antes de unir todas las líneas acumuladas con \n y pasarlas como un
  // único mensaje.
  const PASTE_WINDOW_MS = 50;
  let pasteBuffer: string[] = [];
  let pasteTimer: NodeJS.Timeout | null = null;
  let processing = false;

  const schedulePasteFlush = (): void => {
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => { void flushPaste(); }, PASTE_WINDOW_MS);
  };

  const flushPaste = async (): Promise<void> => {
    pasteTimer = null;
    if (pasteBuffer.length === 0 || processing) return;
    const composed = pasteBuffer.join('\n');
    pasteBuffer = [];
    processing = true;
    try {
      await handleInput(composed);
    } finally {
      processing = false;
      if (pasteBuffer.length > 0) schedulePasteFlush();
    }
  };

  rl.on('line', (line: string) => {
    pasteBuffer.push(line);
    if (processing) return; // finally re-agenda al terminar handleInput
    schedulePasteFlush();
  });

  prompt();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
