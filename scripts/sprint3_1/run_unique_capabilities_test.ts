#!/usr/bin/env node
/**
 * Prueba funcional Sprint 3.1 — Capacidades únicas.
 *
 * Encadena los 4 módulos del sprint en un mini-escenario realista:
 *
 *   1. Multi-user: alta de un owner + 2 collaborators con scoped dirs.
 *   2. Audit fake: dos sesiones simuladas con éxitos y fallos.
 *   3. Mission replay: timeline + summary + dryRunReplay con executor mock.
 *   4. Self-debug: diagnóstico de los fallos del audit usando los
 *      patrones heurísticos.
 *   5. A2A: un agente externo "kernel-friend" pide mission_handoff a
 *      Shinobi con auth bearer; Shinobi responde con su agent_card.
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { UserRegistry } from '../../src/multiuser/user_registry.js';
import { timeline, summarize, dryRunReplay, formatSummary } from '../../src/replay/mission_replay.js';
import { diagnoseError, formatReport } from '../../src/selfdebug/self_debug.js';
import { A2ADispatcher, buildAgentCard, type A2AEnvelope } from '../../src/a2a/protocol.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint 3.1 — Capacidades únicas ===');
  const work = mkdtempSync(join(tmpdir(), 'sprint3_1-'));

  try {
    // ── 1. Multi-user ──
    console.log('\n--- 1. Multi-user registry ---');
    const reg = new UserRegistry(work);
    reg.create({ userId: 'angel', displayName: 'Angel', role: 'owner' });
    reg.create({ userId: 'bob', displayName: 'Bob' });
    reg.create({ userId: 'guest1', displayName: 'Guest', role: 'guest' });
    check(reg.list().length === 3, '3 users registrados');
    check(reg.ownerId() === 'angel', 'owner=angel');
    check(existsSync(reg.scopedPath('bob', 'memory.json').replace('memory.json', '')), 'bob dir creado');
    check(reg.canActOn('angel', 'admin', 'bob') === true, 'owner puede admin');
    check(reg.canActOn('guest1', 'write', 'guest1') === false, 'guest no escribe ni en sí');

    // Persistencia: cerrar e reabrir.
    const reg2 = new UserRegistry(work);
    check(reg2.list().length === 3, 'estado persiste tras reload');

    // ── 2. Audit fake ──
    console.log('\n--- 2. Audit fake con éxitos y fallos ---');
    const audit = join(work, 'audit.jsonl');
    const fakeEvents = [
      { kind: 'tool_call', ts: '2026-05-14T10:00:00Z', tool: 'read_file', argsHash: 'h1', argsPreview: '{}', success: true,  durationMs: 12, sessionId: 'S-angel' },
      { kind: 'tool_call', ts: '2026-05-14T10:00:05Z', tool: 'read_file', argsHash: 'h2', argsPreview: '{}', success: false, durationMs: 22, sessionId: 'S-angel', error: "ENOENT: no such file or directory, open '/nope'" },
      { kind: 'tool_call', ts: '2026-05-14T10:00:10Z', tool: 'http_call', argsHash: 'h3', argsPreview: '{}', success: false, durationMs: 5500, sessionId: 'S-angel', error: 'connect ECONNREFUSED 127.0.0.1:9999' },
      { kind: 'failover',  ts: '2026-05-14T10:00:12Z', from: 'anthropic', to: 'openai', reason: '429 too many requests' },
      { kind: 'tool_call', ts: '2026-05-14T10:00:20Z', tool: 'write_file', argsHash: 'h4', argsPreview: '{}', success: true,  durationMs: 8, sessionId: 'S-angel' },
      { kind: 'loop_abort', ts: '2026-05-14T10:00:25Z', tool: 'agent_loop', verdict: 'LOOP_DETECTED', argsHash: 'h5', sessionId: 'S-angel' },
    ];
    writeFileSync(audit, fakeEvents.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    check(existsSync(audit), 'audit.jsonl escrito');

    // ── 3. Mission replay ──
    console.log('\n--- 3. Mission replay ---');
    const tl = timeline({ auditLogPath: audit });
    check(tl.length === 6, 'timeline=6 eventos');
    const sum = summarize({ auditLogPath: audit });
    check(sum.toolCalls === 4, '4 tool calls');
    check(sum.toolCallFails === 2, '2 fails');
    check(sum.loopAborts === 1 && sum.failovers === 1, '1 loop_abort + 1 failover');
    console.log('  ' + formatSummary(sum).split('\n').join('\n  '));

    const replay = await dryRunReplay({ auditLogPath: audit }, async (e) => ({
      ok: !!e.success,
    }));
    check(replay.length === 4, 'dryRunReplay corre los 4 tool_calls');
    check(replay.every(r => r.divergence === undefined), 'sin divergencias con executor que respeta original');

    const replayDiverge = await dryRunReplay({ auditLogPath: audit }, async () => ({ ok: true }));
    const diverged = replayDiverge.filter(r => r.divergence);
    check(diverged.length === 2, 'detecta 2 divergencias cuando executor falsea todo OK');

    // ── 4. Self-debug ──
    console.log('\n--- 4. Self-debug de los fallos del audit ---');
    const enoentReport = diagnoseError({
      tool: 'read_file', args: { path: '/nope' },
      error: "ENOENT: no such file or directory, open '/nope'",
      auditLogPath: audit,
    });
    check(enoentReport.rootCauseHypotheses[0].cause.toLowerCase().includes('filesystem') ||
          enoentReport.rootCauseHypotheses[0].cause.toLowerCase().includes('recurso'),
          'ENOENT clasificado como filesystem');
    check(enoentReport.relatedAuditEntries.length >= 1, 'correlación con audit detecta historial');

    const econnReport = diagnoseError({
      tool: 'http_call', args: { url: 'http://localhost:9999' },
      error: 'connect ECONNREFUSED 127.0.0.1:9999',
    });
    check(econnReport.rootCauseHypotheses[0].cause.toLowerCase().includes('escuchando'),
          'ECONNREFUSED clasificado como servicio caído');

    console.log('  --- Report ENOENT ---');
    console.log('  ' + formatReport(enoentReport).split('\n').slice(0, 8).join('\n  '));

    // ── 5. A2A protocol ──
    console.log('\n--- 5. A2A protocol ---');
    const dispatched: string[] = [];
    const dispatcher = new A2ADispatcher({
      selfId: 'shinobi',
      auth: 'bearer',
      sharedSecret: 's3cr3t',
      onEvent: (info) => dispatched.push(`${info.env.intent}:${info.ok}`),
    });
    dispatcher.on('ping', async () => ({ result: { pong: true, agentVersion: '0.1.0' } }));
    dispatcher.on('mission_handoff', async (env) => ({
      result: { accepted: true, mission: (env.payload as any).mission, queueEta: '15s' },
    }));

    const envPing: A2AEnvelope = {
      v: 1, traceId: 'tr_demo_1', from: 'kernel-friend', to: 'shinobi',
      intent: 'ping', payload: {}, ts: new Date().toISOString(),
    };
    const respPing = await dispatcher.dispatch(envPing, { bearer: 's3cr3t' });
    check(respPing.ok === true, 'ping OK con bearer correcto');
    check((respPing.result as any).pong === true, 'pong=true');

    const respUnauth = await dispatcher.dispatch(envPing, { bearer: 'wrong' });
    check(respUnauth.ok === false && respUnauth.error === 'unauthorized', 'unauthorized con bearer mal');

    const envMission: A2AEnvelope = {
      v: 1, traceId: 'tr_demo_2', from: 'kernel-friend', to: 'shinobi',
      intent: 'mission_handoff',
      payload: { mission: 'audit competidor X y emite informe' },
      ts: new Date().toISOString(),
    };
    const respMission = await dispatcher.dispatch(envMission, { bearer: 's3cr3t' });
    check(respMission.ok === true, 'mission_handoff aceptado');
    check((respMission.result as any).accepted === true, 'accepted=true');

    const card = buildAgentCard({
      agentId: 'shinobi-prod',
      displayName: 'Shinobi',
      version: '0.3.1',
      capabilities: [
        { name: 'browse', description: 'browser_use con Playwright' },
        { name: 'mission_orchestrate', description: 'orquesta misiones largas con loop detector v2' },
      ],
      auth: 'bearer',
      endpoint: 'http://localhost:3333/a2a',
    });
    check(card.intents.includes('ping') && card.intents.includes('mission_handoff'),
          'agent_card publica intents');
    check(card.capabilities.length === 2, 'agent_card lista 2 capabilities');

    console.log(`  onEvent capturó: ${dispatched.join(', ')}`);

    // ── Resumen final ──
    console.log('\n=== Summary ===');
    if (failed > 0) {
      console.log(`FAIL · ${failed} aserciones`);
      process.exit(1);
    }
    console.log('PASS · self-debug + mission replay + multi-user + A2A integrados');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Sprint 3.1 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
