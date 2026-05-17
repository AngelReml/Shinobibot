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
import { skillManager } from '../skills/skill_manager.js';
import { curatedMemory } from '../memory/curated_memory.js';
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
      console.log(`Modelo activo: ${ShinobiOrchestrator.getModel()}`);
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

  // /tier — eliminado. Llamaba a getTier()/setTier() que NUNCA existieron en
  // el orchestrator (el `?.` se tragaba la llamada): era un no-op silencioso
  // que además usaba vocabulario de tier (FAST/BALANCED/REASONING) ajeno al
  // del router real. La selección de modelo se controla con `/model <name>`
  // (override manual) y la env `SHINOBI_MODEL_ROUTER` (router automático).
  if (trimmed === '/tier' || trimmed.startsWith('/tier ')) {
    console.log('`/tier` fue retirado. Usa `/model <nombre>` para fijar el modelo manualmente,');
    console.log('o `/model auto` + la env SHINOBI_MODEL_ROUTER para que el router decida.');
    return true;
  }

  // /memory <recall|store|stats|forget|user|env|snapshot> ...
  if (trimmed.startsWith('/memory')) {
    const parts = trimmed.split(/\s+/);
    const memAction = parts[1];
    const memArgs = parts.slice(2).join(' ');

    // Bloque 4 — curated memory commands. Coexisten con la transaccional
    // (recall/store/stats/forget) sin colisión: archivos USER.md/MEMORY.md
    // vs SQLite memory_store.
    if (memAction === 'snapshot') {
      const snap = curatedMemory().getSnapshot();
      if (!snap) console.log('(snapshot vacío — añade contenido a USER.md o MEMORY.md y reinicia)');
      else console.log(snap);
      return true;
    }

    if (memAction === 'user') {
      const sub = parts[2];
      if (sub === 'show') {
        const text = curatedMemory().showUser();
        console.log(text || '(USER.md vacío)');
        return true;
      }
      if (sub === 'edit') {
        // /memory user edit "section name" contenido… | /memory user edit name contenido…
        const rest = trimmed.slice(trimmed.indexOf('edit') + 'edit'.length).trim();
        const m = rest.match(/^(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/);
        if (!m) { console.log('Usage: /memory user edit "<sección>" <contenido>'); return true; }
        const name = m[1] ?? m[2];
        const content = m[3];
        const r = curatedMemory().editUserSection(name, content);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        return true;
      }
      console.log('Usage: /memory user show | /memory user edit "<sección>" <contenido>');
      return true;
    }

    if (memAction === 'env') {
      const sub = parts[2];
      if (sub === 'show') {
        const text = curatedMemory().showMemory();
        console.log(text || '(MEMORY.md vacío)');
        const pending = curatedMemory().listPending();
        if (pending.length > 0) {
          console.log(`\n${pending.length} propuesta(s) pendiente(s):`);
          for (const p of pending) console.log(`  #${p.idx} [${p.ts}] ${p.note.slice(0, 100)}`);
        }
        return true;
      }
      if (sub === 'append') {
        const note = trimmed.slice(trimmed.indexOf('append') + 'append'.length).trim();
        if (!note) { console.log('Usage: /memory env append <nota>'); return true; }
        const r = curatedMemory().appendEnv(note);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        return true;
      }
      if (sub === 'propose') {
        const note = trimmed.slice(trimmed.indexOf('propose') + 'propose'.length).trim();
        if (!note) { console.log('Usage: /memory env propose <nota>'); return true; }
        const r = curatedMemory().proposeEnv(note);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        return true;
      }
      if (sub === 'approve' && parts[3]) {
        const idx = parseInt(parts[3], 10);
        if (!Number.isFinite(idx)) { console.log('Usage: /memory env approve <idx>'); return true; }
        const r = curatedMemory().approveEnvProposal(idx);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        return true;
      }
      if (sub === 'reject' && parts[3]) {
        const idx = parseInt(parts[3], 10);
        if (!Number.isFinite(idx)) { console.log('Usage: /memory env reject <idx>'); return true; }
        const r = curatedMemory().rejectEnvProposal(idx);
        console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
        return true;
      }
      console.log('Usage: /memory env show | append <nota> | propose <nota> | approve <idx> | reject <idx>');
      return true;
    }

    // Transaccional (existente, no se toca).
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
        console.log('       /memory user show | /memory user edit "<sección>" <contenido>');
        console.log('       /memory env show | append | propose | approve <idx> | reject <idx>');
        console.log('       /memory snapshot');
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
      // Bloque 3: try local SKILL.md pending first, then fall back to the
      // OpenGravity executable-skill flow. Both id namespaces coexist.
      const id = parts[2];
      const local = skillManager().approve(id);
      if (local.ok) {
        console.log(`✓ ${local.message}`);
        return true;
      }
      const result = await SkillLoader.approveAndLoad(id);
      console.log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
      return true;
    }

    if (sub === 'list-approved') {
      const files = SkillLoader.listApprovedFiles();
      console.log(`\n${files.length} executable skill(s) approved locally (.mjs):`);
      files.forEach(f => console.log('  -', f));
      const md = skillManager().loadApproved();
      console.log(`\n${md.count} markdown skill(s) approved (SKILL.md):`);
      // (Re)read the directory directly so we can show name + id even when
      // loadApproved doesn't expose the index publicly.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'skills', 'approved');
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith('.skill.md'))) {
          const id = f.replace(/\.skill\.md$/, '');
          try {
            const text = fs.readFileSync(path.join(dir, f), 'utf-8');
            const m = text.match(/^name:\s*(.+)$/m);
            const nm = m ? m[1].trim().replace(/^["']|["']$/g, '') : '(no name)';
            console.log(`  - ${id} — ${nm}`);
          } catch { console.log(`  - ${id}`); }
        }
      }
      if (md.errors.length) {
        console.log('\nErrors loading markdown skills:');
        md.errors.forEach(e => console.log('  -', e));
      }
      return true;
    }

    if (sub === 'reload') {
      const r = await SkillLoader.reloadAllApproved();
      console.log(`Loaded ${r.loaded} executable skill(s). Errors: ${r.errors.length}`);
      r.errors.forEach(e => console.log('  -', e));
      const md = skillManager().loadApproved();
      console.log(`Loaded ${md.count} markdown skill(s). Errors: ${md.errors.length}`);
      md.errors.forEach(e => console.log('  -', e));
      return true;
    }

    // Bloque 3: /skill propose [<contexto opcional>]
    if (sub === 'propose') {
      const context = trimmed.slice('/skill propose'.length).trim();
      let effective = context;
      if (!effective) {
        const last = skillManager().getLastObservedRun();
        if (!last) {
          console.log('No context provided and no recent run observed. Usage: /skill propose <contexto>');
          return true;
        }
        effective = `Last observed task: "${last.input}"\nTool sequence: ${last.toolSequence.join(' -> ')}\nSuccess: ${last.success}${last.error ? `\nError: ${last.error}` : ''}`;
      }
      console.log('Generating skill proposal in background…');
      // Fire-and-forget; the user will see the result via /skill review or
      // a `skill_event` over WS.
      void skillManager().proposeSkill(effective, 'manual').then(r => {
        if (r.ok) console.log(`✓ Skill propuesta creada: ${r.name} (id=${r.id}). Revisa con /skill review.`);
        else console.log(`✗ Skill proposal failed: ${r.error}`);
      });
      return true;
    }

    // Bloque 3: /skill review
    if (sub === 'review') {
      const pending = skillManager().listPending();
      if (pending.length === 0) {
        console.log('No pending skills.');
        return true;
      }
      console.log(`\n${pending.length} pending skill(s):`);
      for (const p of pending) {
        console.log(`  - ${p.id} | ${p.name} | source=${p.source_kind} | created=${p.created_at}`);
        if (p.description) console.log(`      ${p.description}`);
      }
      console.log('\nUse /skill approve <id> or /skill reject <id>.');
      return true;
    }

    // Bloque 3: /skill reject <id>
    if (sub === 'reject' && parts[2]) {
      const r = skillManager().reject(parts[2]);
      console.log(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
      return true;
    }

    console.log('Usage: /skill list | /skill approve <id> | /skill reject <id> | /skill list-approved | /skill reload | /skill propose [<contexto>] | /skill review');
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

  // /doc <word|pdf|excel|markdown|auto> <instrucción> — Bloque 5
  if (trimmed.startsWith('/doc')) {
    const rest = trimmed.slice('/doc'.length).trim();
    if (!rest) {
      console.log('Usage: /doc <word|pdf|excel|markdown|auto> <instrucción>');
      console.log('  ej: /doc word "informe sobre tendencias 2026 — 5 secciones"');
      console.log('  ej: /doc auto "tabla con los gastos del mes"');
      return true;
    }
    const m = rest.match(/^(word|pdf|excel|markdown|auto)\s+(.+)$/is);
    if (!m) {
      console.log('Tipo no reconocido. Usa: word | pdf | excel | markdown | auto.');
      return true;
    }
    const [, t, instruction] = m;
    const type = t.toLowerCase() as 'word' | 'pdf' | 'excel' | 'markdown' | 'auto';
    console.log(`[doc] Pidiendo al LLM que genere ${type} con instrucción: "${instruction.slice(0, 80)}…"`);
    // Slash flow: delegate to the orchestrator which will pick the
    // generate_document tool autonomously. The user's input becomes the LLM
    // prompt with an explicit instruction to call generate_document.
    const llmPrompt =
      `Generate a ${type === 'auto' ? 'document (auto-detect type)' : type} document. ` +
      `Use the generate_document tool with type:"${type}" and an appropriate title. ` +
      `Instruction: ${instruction}`;
    try {
      const result = await ShinobiOrchestrator.process(llmPrompt);
      if (result?.response) console.log(result.response);
    } catch (e: any) {
      console.log(`[doc] error: ${e?.message ?? e}`);
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

  // /sentinel <watch|ask|deep|list|forward|digest> — vigilancia tecnológica (V4.5)
  if (trimmed.startsWith('/sentinel')) {
    const argv = trimmed.slice('/sentinel'.length).trim();
    const { handleSentinel } = await import('../sentinel/sentinel_command.js');
    const { memoryProviderRegistry } = await import('../memory/provider_registry.js');
    const { invokeLLM } = await import('../providers/provider_router.js');

    const provider = await memoryProviderRegistry().getProvider();
    const proposalLLM = async (prompt: string): Promise<string> => {
      const r = await invokeLLM({ messages: [{ role: 'user', content: prompt }] });
      if (!r.success) throw new Error(r.error || 'LLM falló');
      return r.output;
    };
    const councilLLM = async (system: string, user: string): Promise<string> => {
      const r = await invokeLLM({
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      if (!r.success) throw new Error(r.error || 'LLM falló');
      return r.output;
    };

    try {
      await handleSentinel(argv, { provider, proposalLLM, councilLLM });
    } catch (e: any) {
      console.error(`[sentinel] error: ${e?.message ?? e}`);
    }
    return true;
  }

  // Not a recognised slash command.
  return false;
}
