#!/usr/bin/env node
/**
 * Shinobi CLI v5 - Connected to OpenGravity Kernel
 */

import * as readline from 'readline';
import { ShinobiOrchestrator } from '../src/coordinator/orchestrator.js';
import { KernelClient } from '../src/bridge/kernel_client.js';
import { SkillLoader } from '../src/skills/skill_loader.js';
import { ResidentLoop } from '../src/runtime/resident_loop.js';
import { Notifier } from '../src/notifications/notifier.js';
import axios from 'axios';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { configExists, loadConfig, runFirstRunWizard } from '../src/runtime/first_run_wizard.js';

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
    const noRecord = argv.includes('--no-record');
    if (!task_id) {
      console.error('Usage: shinobi demo --task <T01..T30 | killer> [--no-record]');
      process.exit(2);
    }
    if (task_id === 'killer') {
      // C7.5 — wrap the killer demo with optional OBS bracketing (H1/H2).
      const path = await import('node:path');
      const { spawn } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const __scriptsDir = path.dirname(fileURLToPath(import.meta.url));
      const runnerPath = path.resolve(__scriptsDir, '..', 'demos', 'killer_demo_runner.mjs');
      let recStarted = false;
      if (!noRecord) {
        try {
          const recMod: any = await import('../skills/desktop/desktop-obs-record-self/scripts/skill.mjs');
          const r = await recMod.default.execute({ scene: 'Shinobi Killer Demo', auto_launch: true });
          if (r.success) { console.log('[killer] OBS recording started'); recStarted = true; }
          else console.log('[killer] OBS recording skipped:', r.error);
        } catch (e: any) { console.log('[killer] OBS skipped:', e?.message ?? e); }
      } else {
        console.log('[killer] --no-record, OBS bracketing skipped');
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
    const r = await runDemo({ task_id, noRecord });
    console.log('\n=== demo summary ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }

  // H5 — full self-improvement demo with auto-recording.
  if (argv[0] === 'run-demo' && argv[1] === 'full-self-improve') {
    const noRecord = argv.includes('--no-record');
    const { runDemo } = await import('../src/demo/demo_runner.js');
    const r = await runDemo({ fullSelfImprove: true, noRecord });
    console.log('\n=== run-demo summary ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
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
  console.log('  /memory      - Gestionar memoria (/memory recall <q> | store <txt> | stats | forget <id>)');
  console.log('  /skill       - Gestionar skills (/skill list | approve <id> | list-approved | reload)');
  console.log('  /resident    - Misiones recurrentes (/resident start|stop|status|add|enable|disable|delete|reset|logs)');
  console.log('  /notify      - Notificaciones (/notify set <workflow_id> | unset | test)');
  console.log('  /record      - Auto-grabar sesion en OBS (/record start | /record stop)');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const residentLoop = new ResidentLoop();

  await checkKernel();

  // A5 — surface any pending Hermes upstream notice + start 24h watcher in the background.
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

  // Auto-reload previously approved skills
  try {
    const r = await SkillLoader.reloadAllApproved();
    if (r.loaded > 0) console.log(`[Shinobi] Cargadas ${r.loaded} skill(s) aprobadas previamente.`);
    if (r.errors.length > 0) {
      console.log(`[Shinobi] ${r.errors.length} skill(s) fallaron al cargar:`);
      r.errors.forEach(e => console.log('  -', e));
    }
  } catch (e: any) {
    console.log('[Shinobi] Error cargando skills aprobadas:', e.message);
  }

  console.log('');
  
  const prompt = () => {
    rl.question('Shinobi > ', async (input) => {
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
      
      // /record start|stop — bracket a session with OBS recording.
      if (trimmed.startsWith('/record')) {
        const sub = trimmed.split(/\s+/)[1] ?? '';
        if (sub !== 'start' && sub !== 'stop') {
          console.log('Usage: /record start | /record stop');
        } else {
          try {
            const mod: any = await import('../skills/composite/record-my-session/scripts/skill.mjs');
            const tool = mod.default;
            const r = await tool.execute({ action: sub });
            if (r.success) {
              const parsed = JSON.parse(r.output);
              if (sub === 'start') console.log(`[record] started — scene=${parsed.scene}${parsed.started_at ? ' at ' + parsed.started_at : ''}`);
              else console.log(`[record] stopped — output: ${parsed.output_path ?? '(no active recording)'}${parsed.size_bytes ? ' (' + parsed.size_bytes + ' bytes)' : ''}`);
            } else {
              console.log('[record] error:', r.error);
            }
          } catch (e: any) {
            console.log('[record] failed:', e?.message ?? e);
          }
        }
        prompt();
        return;
      }

      // Special commands
      if (trimmed.startsWith('/mode ')) {
        const mode = trimmed.split(' ')[1] as 'local' | 'kernel' | 'auto';
        if (['local', 'kernel', 'auto'].includes(mode)) {
          ShinobiOrchestrator.setMode(mode);
        } else {
          console.log('Modos válidos: local, kernel, auto');
        }
        prompt();
        return;
      }
      
      if (trimmed === '/status') {
        await checkKernel();
        prompt();
        return;
      }

      if (trimmed.startsWith('/model')) {
        const parts = trimmed.split(' ');
        if (parts.length === 1) {
          console.log(`Modelo activo: ${ShinobiOrchestrator.getModel()}`);
        } else if (parts[1] === 'auto') {
          ShinobiOrchestrator.setModel(undefined);
          console.log('Modelo: auto (default GLM 4.7)');
        } else if (parts[1] === 'list') {
          console.log('Modelos recomendados:');
          console.log('- z-ai/glm-4.7 (default)');
          console.log('- openai/gpt-4o');
          console.log('- anthropic/claude-3.5-sonnet');
        } else {
          ShinobiOrchestrator.setModel(parts[1]);
          console.log(`Modelo cambiado a: ${parts[1]}`);
        }
        prompt();
        return;
      }
      
      if (trimmed.startsWith('/memory')) {
        const parts = trimmed.split(' ');
        const memAction = parts[1];
        const memArgs = parts.slice(2).join(' ');
        
        try {
          const store = ShinobiOrchestrator.getMemory();
          if (memAction === 'recall') {
            const results = await store.recall({ query: memArgs, limit: 5 });
            console.log('--- Memory Recall ---');
            results.forEach(r => console.log(`[${r.score.toFixed(2)}] ${r.entry.content}`));
          } else if (memAction === 'store') {
            const entry = await store.store(memArgs);
            console.log(`Saved memory (ID: ${entry.id})`);
          } else if (memAction === 'stats') {
            console.log(store.stats());
          } else if (memAction === 'forget') {
            const ok = store.forget(memArgs);
            console.log(ok ? 'Memory forgotten' : 'Memory not found');
          } else {
            console.log('Usage: /memory <recall|store|stats|forget> [args]');
          }
        } catch (e: any) {
          console.error('[memory] Error:', e.message);
        }
        prompt();
        return;
      }
      
      // Skill commands
      if (trimmed.startsWith('/skill ')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1];

        if (sub === 'list') {
          const baseUrl = process.env.OPENGRAVITY_URL || 'http://localhost:9900';
          const apiKey = process.env.SHINOBI_API_KEY || '';
          try {
            const r = await axios.get(`${baseUrl}/v1/skills/list`, { headers: { 'X-Shinobi-Key': apiKey } });
            const list = JSON.parse(r.data.output);
            console.log(`\n${list.length} skill(s):`);
            for (const s of list) {
              console.log(`  - ${s.id} | ${s.name} | status=${s.status} | ${s.description.substring(0, 60)}`);
            }
          } catch (e: any) { console.log('Error:', e.message); }
          prompt();
          return;
        }

        if (sub === 'approve' && parts[2]) {
          const result = await SkillLoader.approveAndLoad(parts[2]);
          console.log(result.success ? `\u2713 ${result.message}` : `\u2717 ${result.message}`);
          prompt();
          return;
        }

        if (sub === 'list-approved') {
          const files = SkillLoader.listApprovedFiles();
          console.log(`\n${files.length} skill(s) approved locally:`);
          files.forEach(f => console.log('  -', f));
          prompt();
          return;
        }

        if (sub === 'reload') {
          const r = await SkillLoader.reloadAllApproved();
          console.log(`Loaded ${r.loaded} skills. Errors: ${r.errors.length}`);
          r.errors.forEach(e => console.log('  -', e));
          prompt();
          return;
        }

        console.log('Usage: /skill list | /skill approve <id> | /skill list-approved | /skill reload');
        prompt();
        return;
      }

      // Resident commands
      if (trimmed.startsWith('/resident')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1];

        if (sub === 'start') {
          residentLoop.start();
          console.log('Resident loop started. Use /resident status to monitor.');
          prompt(); return;
        }
        if (sub === 'stop') {
          residentLoop.stop();
          console.log('Resident loop stopped.');
          prompt(); return;
        }
        if (sub === 'status') {
          const list = residentLoop.getStore().list();
          console.log(`Loop running: ${residentLoop.isRunning()}`);
          console.log(`Missions: ${list.length}`);
          for (const m of list) {
            console.log(`  - ${m.id} | ${m.name} | every ${m.cron_seconds}s | enabled=${m.enabled} | last=${m.last_status || 'never'} | fails=${m.consecutive_failures}`);
          }
          prompt(); return;
        }
        if (sub === 'add') {
          const rest = trimmed.substring('/resident add'.length).trim();
          const match = rest.match(/^"([^"]+)"\s+(\d+)\s+(.+)$/);
          if (!match) { console.log('Usage: /resident add "name" <cron_seconds> <prompt>'); prompt(); return; }
          const created = residentLoop.getStore().create({ name: match[1], cron_seconds: Number(match[2]), prompt: match[3] });
          console.log(`Mission created: ${created.id}`);
          prompt(); return;
        }
        if (sub === 'enable' && parts[2]) {
          residentLoop.getStore().setEnabled(parts[2], true);
          console.log('Mission enabled.');
          prompt(); return;
        }
        if (sub === 'disable' && parts[2]) {
          residentLoop.getStore().setEnabled(parts[2], false);
          console.log('Mission disabled.');
          prompt(); return;
        }
        if (sub === 'reset' && parts[2]) {
          residentLoop.getStore().resetFailures(parts[2]);
          console.log('Failures reset.');
          prompt(); return;
        }
        if (sub === 'delete' && parts[2]) {
          residentLoop.getStore().delete(parts[2]);
          console.log('Mission deleted.');
          prompt(); return;
        }
        if (sub === 'logs' && parts[2]) {
          const logs = residentLoop.getStore().getRecentLogs(parts[2], 5);
          console.log(`Last ${logs.length} logs for ${parts[2]}:`);
          for (const l of logs) console.log(`  [${l.started_at}] ${l.status} | ${(l.output || l.error || '').substring(0, 200)}`);
          prompt(); return;
        }
        console.log('Usage: /resident start | stop | status | add "name" <secs> <prompt> | enable <id> | disable <id> | delete <id> | reset <id> | logs <id>');
        prompt(); return;
      }

      // Notify commands
      if (trimmed.startsWith('/notify')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1];
        if (sub === 'set' && parts[2]) {
          Notifier.setWorkflow(parts[2]);
          console.log(`Notifier configured to use workflow: ${parts[2]}`);
          prompt(); return;
        }
        if (sub === 'unset') {
          Notifier.setWorkflow(null);
          console.log('Notifier disabled (will only print to console).');
          prompt(); return;
        }
        if (sub === 'test') {
          const r = await Notifier.send({ level: 'info', title: 'Test notification', body: 'Hola desde Shinobi.' });
          console.log(`Test send: ${r.success ? 'OK' : 'FAILED — ' + r.error}`);
          prompt(); return;
        }
        console.log('Usage: /notify set <workflow_id> | /notify unset | /notify test');
        prompt(); return;
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
    });
  };
  
  prompt();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});