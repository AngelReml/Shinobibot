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
  if (argv[0] !== 'import' || argv[1] !== 'hermes') return false;
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
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const residentLoop = new ResidentLoop();
  
  await checkKernel();

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