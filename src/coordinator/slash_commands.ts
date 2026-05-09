// src/coordinator/slash_commands.ts
//
// Bloque 1 (UI Web Chat) — extraction shared with both interfaces:
//   - scripts/shinobi.ts          (CLI)
//   - src/web/server.ts           (Web UI, port 3333)
//
// All slash commands the user can type at the prompt are routed through
// handleSlashCommand. The function returns true if the input was a recognised
// slash command (regardless of success), so the caller can short-circuit and
// avoid sending the input to the orchestrator.
//
// User-facing output goes through console.log/console.error. The CLI prints
// directly. The web server monkey-patches console.* during the call to forward
// each line over WebSocket as a "thinking" event, so no separate sink is
// required.

import axios from 'axios';
import { ShinobiOrchestrator } from './orchestrator.js';
import { KernelClient } from '../bridge/kernel_client.js';
import { SkillLoader } from '../skills/skill_loader.js';
import { ResidentLoop } from '../runtime/resident_loop.js';
import { Notifier } from '../notifications/notifier.js';
import {
  setApprovalMode,
  getApprovalMode,
  type ApprovalMode,
} from '../security/approval.js';

export interface SlashContext {
  /**
   * Each interface owns its own resident loop instance (CLI and Web are
   * mutually exclusive per session — see docs/sessions/bloque1_ui_web.md).
   */
  residentLoop: ResidentLoop;
  /**
   * Async question helper for slash commands that need explicit user
   * confirmation (currently only /apply). The CLI wires this to
   * readline.question; the web wires it to a WS request/response round-trip.
   */
  ask: (question: string) => Promise<string>;
}

async function checkKernelStatus(): Promise<boolean> {
  const online = await KernelClient.isOnline();
  if (online) {
    console.log('🟢 OpenGravity Kernel: ONLINE');
  } else {
    console.log('🟡 OpenGravity Kernel: OFFLINE (using local mode)');
    console.log('   To enable kernel: run "kernel.cmd" in OpenGravity folder');
  }
  return online;
}

export async function handleSlashCommand(input: string, ctx: SlashContext): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  // /record start|stop — bracket a session with OBS recording.
  if (trimmed.startsWith('/record')) {
    const sub = trimmed.split(/\s+/)[1] ?? '';
    if (sub !== 'start' && sub !== 'stop') {
      console.log('Usage: /record start | /record stop');
    } else {
      try {
        const mod: any = await import('../../skills/composite/record-my-session/scripts/skill.mjs');
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
    return true;
  }

  // /mode local|kernel|auto
  if (trimmed.startsWith('/mode ')) {
    const mode = trimmed.split(' ')[1] as 'local' | 'kernel' | 'auto';
    if (['local', 'kernel', 'auto'].includes(mode)) {
      ShinobiOrchestrator.setMode(mode);
    } else {
      console.log('Modos válidos: local, kernel, auto');
    }
    return true;
  }

  // /status — accept any trailing args/whitespace (bug fix FAIL 2).
  if (trimmed === '/status' || trimmed.startsWith('/status ')) {
    await checkKernelStatus();
    return true;
  }

  // /model [auto|list|<name>]
  if (trimmed.startsWith('/model')) {
    const parts = trimmed.split(' ');
    if (parts.length === 1) {
      const tier = (ShinobiOrchestrator as any).getTier?.() ?? 'auto';
      console.log(`Modelo activo: ${ShinobiOrchestrator.getModel()} | tier override: ${tier}`);
    } else if (parts[1] === 'auto') {
      ShinobiOrchestrator.setModel(undefined);
      console.log('Modelo: auto (router decide por tier)');
    } else if (parts[1] === 'list') {
      console.log('Modelos recomendados (override manual; bypassea el router):');
      console.log('- z-ai/glm-4.7 (REASONING tier default)');
      console.log('- anthropic/claude-haiku-4.5 (BALANCED tier default)');
      console.log('- openai/gpt-4o-mini (FAST tier default)');
      console.log('- openai/gpt-4o, anthropic/claude-3.5-sonnet (otros)');
    } else {
      ShinobiOrchestrator.setModel(parts[1]);
      console.log(`Modelo cambiado a: ${parts[1]} (bypassea router LLM)`);
    }
    return true;
  }

  // /tier fast|balanced|reasoning|auto
  if (trimmed.startsWith('/tier')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      const tier = (ShinobiOrchestrator as any).getTier?.() ?? 'auto';
      console.log(`Tier activo: ${tier} | modelo override: ${ShinobiOrchestrator.getModel()}`);
    } else {
      const sub = parts[1].toLowerCase();
      if (sub === 'auto') {
        (ShinobiOrchestrator as any).setTier?.(undefined);
        console.log('Tier: auto (router clasifica por heurística)');
      } else if (sub === 'fast' || sub === 'balanced' || sub === 'reasoning') {
        const t = sub.toUpperCase() as 'FAST' | 'BALANCED' | 'REASONING';
        (ShinobiOrchestrator as any).setTier?.(t);
        console.log(`Tier forzado a: ${t}`);
        if (ShinobiOrchestrator.getModel() !== 'default') {
          console.log(`  ⚠ /model está fijado (${ShinobiOrchestrator.getModel()}) — el modelo gana sobre el tier hasta que hagas /model auto.`);
        }
      } else {
        console.log('Usage: /tier fast | balanced | reasoning | auto');
      }
    }
    return true;
  }

  // /memory <recall|store|stats|forget> [args]
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
    return true;
  }

  // /skill list | approve <id> | list-approved | reload
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
      return true;
    }

    if (sub === 'approve' && parts[2]) {
      const result = await SkillLoader.approveAndLoad(parts[2]);
      console.log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
      return true;
    }

    if (sub === 'list-approved') {
      const files = SkillLoader.listApprovedFiles();
      console.log(`\n${files.length} skill(s) approved locally:`);
      files.forEach(f => console.log('  -', f));
      return true;
    }

    if (sub === 'reload') {
      const r = await SkillLoader.reloadAllApproved();
      console.log(`Loaded ${r.loaded} skills. Errors: ${r.errors.length}`);
      r.errors.forEach(e => console.log('  -', e));
      return true;
    }

    console.log('Usage: /skill list | /skill approve <id> | /skill list-approved | /skill reload');
    return true;
  }

  // /resident start|stop|status|add|enable|disable|delete|reset|logs
  if (trimmed.startsWith('/resident')) {
    const parts = trimmed.split(/\s+/);
    const sub = parts[1];
    const residentLoop = ctx.residentLoop;

    if (sub === 'start') {
      residentLoop.start();
      console.log('Resident loop started. Use /resident status to monitor.');
      return true;
    }
    if (sub === 'stop') {
      residentLoop.stop();
      console.log('Resident loop stopped.');
      return true;
    }
    if (sub === 'status') {
      const list = residentLoop.getStore().list();
      console.log(`Loop running: ${residentLoop.isRunning()}`);
      console.log(`Missions: ${list.length}`);
      for (const m of list) {
        console.log(`  - ${m.id} | ${m.name} | every ${m.cron_seconds}s | enabled=${m.enabled} | last=${m.last_status || 'never'} | fails=${m.consecutive_failures}`);
      }
      return true;
    }
    if (sub === 'add') {
      const rest = trimmed.substring('/resident add'.length).trim();
      const match = rest.match(/^"([^"]+)"\s+(\d+)\s+(.+)$/);
      if (!match) { console.log('Usage: /resident add "name" <cron_seconds> <prompt>'); return true; }
      const created = residentLoop.getStore().create({ name: match[1], cron_seconds: Number(match[2]), prompt: match[3] });
      console.log(`Mission created: ${created.id}`);
      return true;
    }
    if (sub === 'enable' && parts[2]) {
      residentLoop.getStore().setEnabled(parts[2], true);
      console.log('Mission enabled.');
      return true;
    }
    if (sub === 'disable' && parts[2]) {
      residentLoop.getStore().setEnabled(parts[2], false);
      console.log('Mission disabled.');
      return true;
    }
    if (sub === 'reset' && parts[2]) {
      residentLoop.getStore().resetFailures(parts[2]);
      console.log('Failures reset.');
      return true;
    }
    if (sub === 'delete' && parts[2]) {
      residentLoop.getStore().delete(parts[2]);
      console.log('Mission deleted.');
      return true;
    }
    if (sub === 'logs' && parts[2]) {
      const logs = residentLoop.getStore().getRecentLogs(parts[2], 5);
      console.log(`Last ${logs.length} logs for ${parts[2]}:`);
      for (const l of logs) console.log(`  [${l.started_at}] ${l.status} | ${(l.output || l.error || '').substring(0, 200)}`);
      return true;
    }
    console.log('Usage: /resident start | stop | status | add "name" <secs> <prompt> | enable <id> | disable <id> | delete <id> | reset <id> | logs <id>');
    return true;
  }

  // /notify set <workflow_id> | unset | test
  if (trimmed.startsWith('/notify')) {
    const parts = trimmed.split(/\s+/);
    const sub = parts[1];
    if (sub === 'set' && parts[2]) {
      Notifier.setWorkflow(parts[2]);
      console.log(`Notifier configured to use workflow: ${parts[2]}`);
      return true;
    }
    if (sub === 'unset') {
      Notifier.setWorkflow(null);
      console.log('Notifier disabled (will only print to console).');
      return true;
    }
    if (sub === 'test') {
      const r = await Notifier.send({ level: 'info', title: 'Test notification', body: 'Hola desde Shinobi.' });
      console.log(`Test send: ${r.success ? 'OK' : 'FAILED — ' + r.error}`);
      return true;
    }
    console.log('Usage: /notify set <workflow_id> | /notify unset | /notify test');
    return true;
  }

  // /read <path> [--budget=N]
  if (trimmed.startsWith('/read')) {
    const argv = trimmed.slice('/read'.length).trim();
    const { runRead, parseReadArgs } = await import('../reader/cli.js');
    const parsed = parseReadArgs(argv);
    if (parsed.error) {
      console.log(parsed.error);
    } else {
      await runRead(parsed.path!, { budgetTokens: parsed.budgetTokens });
    }
    return true;
  }

  // /ledger verify | export
  if (trimmed.startsWith('/ledger')) {
    const sub = trimmed.slice('/ledger'.length).trim().split(/\s+/)[0] ?? '';
    const { MissionLedger } = await import('../ledger/MissionLedger.js');
    const ledger = new MissionLedger();
    if (sub === 'verify') {
      const v = ledger.verify();
      console.log(`[ledger] entries: ${v.entries}`);
      console.log(`[ledger] integrity: ${v.ok ? 'INTACT ✅' : 'BROKEN ❌'}`);
      if (!v.ok) for (const b of v.breakages) console.log(`  - [${b.index}] ${b.reason}`);
    } else if (sub === 'export') {
      const exp = ledger.export();
      const fs = await import('node:fs');
      const path = await import('node:path');
      const outDir = path.join(process.cwd(), 'ledger');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, `export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(out, JSON.stringify(exp, null, 2));
      console.log(`[ledger] count=${exp.count}  head=${exp.head.slice(0, 12) || '<empty>'}…`);
      console.log(`[ledger] export → ${out}`);
    } else {
      console.log('Usage: /ledger verify | /ledger export');
    }
    return true;
  }

  // /learn <ruta_o_url>
  if (trimmed.startsWith('/learn')) {
    const argv = trimmed.slice('/learn'.length).trim();
    const { runLearn, parseLearnArgs } = await import('../knowledge/learn.js');
    const parsed = parseLearnArgs(argv);
    if (parsed.error) { console.log(parsed.error); return true; }
    await runLearn(parsed.input!);
    return true;
  }

  // /improvements [<committee.json>]
  if (trimmed.startsWith('/improvements')) {
    const argv = trimmed.slice('/improvements'.length).trim();
    const { runImprovements } = await import('../committee/improvements.js');
    await runImprovements(argv || undefined);
    return true;
  }

  // /apply <id>
  if (trimmed.startsWith('/apply')) {
    const id = trimmed.slice('/apply'.length).trim();
    if (!id) { console.log('Usage: /apply <proposal_id>'); return true; }
    const { applyProposal } = await import('../committee/improvements.js');
    const r = await applyProposal(id, ctx.ask);
    console.log(`[apply] ${r.ok ? 'OK' : 'FAIL'} — ${r.message}`);
    return true;
  }

  // /committee [<report.json>]
  if (trimmed.startsWith('/committee')) {
    const argv = trimmed.slice('/committee'.length).trim();
    const { runCommittee, parseCommitteeArgs, findLatestSelfReport } = await import('../committee/cli.js');
    let target: string | undefined;
    if (!argv) {
      target = findLatestSelfReport();
      if (!target) {
        console.log('No self_reports/ found. Run /self first or pass a report path.');
        return true;
      }
      console.log(`[committee] using latest self_report: ${target}`);
    } else {
      const parsed = parseCommitteeArgs(argv);
      if (parsed.error) { console.log(parsed.error); return true; }
      target = parsed.path!;
    }
    await runCommittee(target);
    return true;
  }

  // /self [--diff] [--budget=N]
  if (trimmed.startsWith('/self')) {
    const argv = trimmed.slice('/self'.length).trim();
    const { runSelf, runSelfDiff, parseSelfArgs } = await import('../reader/self.js');
    const parsed = parseSelfArgs(argv);
    if (parsed.error) {
      console.log(parsed.error);
    } else if (parsed.diff) {
      await runSelfDiff();
    } else {
      await runSelf({ budgetTokens: parsed.budgetTokens });
    }
    return true;
  }

  // /approval [on|smart|off]
  if (trimmed.startsWith('/approval')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      console.log(`Approval mode: ${getApprovalMode()}`);
    } else {
      const sub = parts[1].toLowerCase();
      if (sub === 'on' || sub === 'smart' || sub === 'off') {
        setApprovalMode(sub as ApprovalMode);
        if (sub === 'off') {
          console.log('');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('⚠️  APPROVAL OFF — Shinobi tiene permisos absolutos en tu máquina.');
          console.log('   Sin frenos. Sin confirmaciones. Sin sandbox.');
          console.log('   Para revertir: /approval smart');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('');
        } else {
          console.log(`Approval mode: ${sub}`);
        }
      } else {
        console.log('Usage: /approval [on|smart|off]');
      }
    }
    return true;
  }

  // Not a recognised slash command.
  return false;
}
