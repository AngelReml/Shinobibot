// src/bench/adapters/shinobi_adapter.ts
//
// Adaptador del PROPIO shinobi al harness. Corre un agent_loop con la caja
// COMPLETA de herramientas, en el workdir aislado de la tarea (contexto ALS, el
// mismo de Team), y persiste su audit.jsonl para el paquete de "provable
// autonomy". Lee el audit para emitir métricas (FASE 4): tool calls, fallos y
// BUCLES ABORTADOS por el loop-detector. En modo `verified`, usa runVerifiedAgent
// (E1) y reporta la AUTO-CORRECCIÓN. El LLM es inyectable.

import * as fs from 'fs';
import * as path from 'path';
import { runAgentLoop, type LLMInvoker } from '../../agents/agent_loop.js';
import { runVerifiedAgent } from '../../agents/verified_agent.js';
import { runInContext } from '../../agents/exec_context.js';
import { getAllTools } from '../../tools/index.js';
import { parseAuditLines } from '../../audit/trust_ledger.js';
import type { AgentAdapter, AgentRunResult, BenchTask, TaskContext } from '../types.js';

const SYSTEM =
  'Eres shinobi, un agente autónomo. Resuelve la tarea trabajando en el directorio ' +
  'actual con las herramientas disponibles. Sé directo y eficiente. Cuando termines, ' +
  'responde con un resumen breve de lo que hiciste.';

function auditMetrics(auditPath: string): AgentRunResult['metrics'] {
  try {
    if (!fs.existsSync(auditPath)) return { toolCalls: 0, successes: 0, failures: 0, loopAborts: 0 };
    const events = parseAuditLines(fs.readFileSync(auditPath, 'utf-8'));
    let toolCalls = 0, successes = 0, failures = 0, loopAborts = 0;
    for (const ev of events) {
      if (ev.kind === 'tool_call') { toolCalls++; if ((ev as any).success) successes++; else failures++; }
      else if (ev.kind === 'loop_abort') loopAborts++;
    }
    return { toolCalls, successes, failures, loopAborts };
  } catch {
    return { toolCalls: 0, successes: 0, failures: 0, loopAborts: 0 };
  }
}

export class ShinobiAdapter implements AgentAdapter {
  readonly id = 'shinobi';
  private readonly invokeLLM?: LLMInvoker;
  private readonly toolBox?: string[];
  private readonly verified: boolean;

  constructor(opts: { invokeLLM?: LLMInvoker; tools?: string[]; verified?: boolean } = {}) {
    this.invokeLLM = opts.invokeLLM;
    this.toolBox = opts.tools;
    this.verified = !!opts.verified;
  }

  async isAvailable(): Promise<boolean> { return true; }

  async run(task: BenchTask, ctx: TaskContext): Promise<AgentRunResult> {
    const tools = this.toolBox ?? getAllTools().map((t) => t.name);
    const auditPath = path.join(ctx.workdir, 'audit.jsonl');
    const maxIterations = task.limits?.maxIterations ?? 12;

    const prevAudit = process.env.SHINOBI_AUDIT_LOG_PATH;
    process.env.SHINOBI_AUDIT_LOG_PATH = auditPath;
    const t0 = Date.now();
    try {
      if (this.verified) {
        const vr = await runInContext(
          { cwd: ctx.workdir, workspaceRoot: ctx.workdir },
          () => runVerifiedAgent({
            task: task.prompt, systemPrompt: SYSTEM, tools, label: `bench:${task.id}`,
            maxIterations, maxAttempts: 2, invokeLLM: this.invokeLLM, verifyInvokeLLM: this.invokeLLM,
          }),
        );
        const last = vr.history[vr.history.length - 1]?.result;
        return {
          finalText: vr.output, ok: vr.ok,
          iterations: last?.iterations ?? 0, toolsUsed: last?.toolsUsed ?? [],
          durationMs: Date.now() - t0, auditPath, metrics: auditMetrics(auditPath),
          attempts: vr.attempts, selfCorrected: vr.attempts > 1 && vr.ok,
          error: vr.ok ? undefined : (vr.verdict.issues[0] ?? 'no aprobado'),
        };
      }
      const result = await runInContext(
        { cwd: ctx.workdir, workspaceRoot: ctx.workdir },
        () => runAgentLoop({
          task: task.prompt, systemPrompt: SYSTEM, tools, label: `bench:${task.id}`,
          maxIterations, invokeLLM: this.invokeLLM,
        }),
      );
      return {
        finalText: result.output, ok: result.ok,
        iterations: result.iterations, toolsUsed: result.toolsUsed,
        durationMs: Date.now() - t0, auditPath, metrics: auditMetrics(auditPath),
        error: result.ok ? undefined : (result.error ?? result.verdict),
      };
    } catch (e: any) {
      return { finalText: '', ok: false, iterations: 0, toolsUsed: [], durationMs: Date.now() - t0, error: e?.message ?? String(e) };
    } finally {
      if (prevAudit === undefined) delete process.env.SHINOBI_AUDIT_LOG_PATH;
      else process.env.SHINOBI_AUDIT_LOG_PATH = prevAudit;
    }
  }
}
