// src/bench/adapters/shinobi_adapter.ts
//
// Adaptador del PROPIO shinobi al harness. Corre un agent_loop con la caja
// COMPLETA de herramientas, en el workdir aislado de la tarea (contexto ALS, el
// mismo de Team), y persiste su audit.jsonl para el paquete de "provable
// autonomy". El LLM es inyectable: por defecto el provider router real; en test
// se inyecta uno determinista.

import * as path from 'path';
import { runAgentLoop, type LLMInvoker } from '../../agents/agent_loop.js';
import { runInContext } from '../../agents/exec_context.js';
import { getAllTools } from '../../tools/index.js';
import type { AgentAdapter, AgentRunResult, BenchTask, TaskContext } from '../types.js';

const SYSTEM =
  'Eres shinobi, un agente autónomo. Resuelve la tarea trabajando en el directorio ' +
  'actual con las herramientas disponibles. Sé directo y eficiente. Cuando termines, ' +
  'responde con un resumen breve de lo que hiciste.';

export class ShinobiAdapter implements AgentAdapter {
  readonly id = 'shinobi';
  private readonly invokeLLM?: LLMInvoker;
  private readonly toolBox?: string[];

  constructor(opts: { invokeLLM?: LLMInvoker; tools?: string[] } = {}) {
    this.invokeLLM = opts.invokeLLM;
    this.toolBox = opts.tools;
  }

  async isAvailable(): Promise<boolean> {
    return true; // shinobi siempre está disponible (es el repo local)
  }

  async run(task: BenchTask, ctx: TaskContext): Promise<AgentRunResult> {
    const tools = this.toolBox ?? getAllTools().map((t) => t.name);
    const auditPath = path.join(ctx.workdir, 'audit.jsonl');

    const prevAudit = process.env.SHINOBI_AUDIT_LOG_PATH;
    process.env.SHINOBI_AUDIT_LOG_PATH = auditPath;
    const t0 = Date.now();
    try {
      const result = await runInContext(
        { cwd: ctx.workdir, workspaceRoot: ctx.workdir },
        () => runAgentLoop({
          task: task.prompt,
          systemPrompt: SYSTEM,
          tools,
          label: `bench:${task.id}`,
          maxIterations: task.limits?.maxIterations ?? 12,
          invokeLLM: this.invokeLLM,
        }),
      );
      return {
        finalText: result.output,
        ok: result.ok,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
        durationMs: Date.now() - t0,
        auditPath,
        error: result.ok ? undefined : (result.error ?? result.verdict),
      };
    } catch (e: any) {
      return {
        finalText: '', ok: false, iterations: 0, toolsUsed: [],
        durationMs: Date.now() - t0, error: e?.message ?? String(e),
      };
    } finally {
      if (prevAudit === undefined) delete process.env.SHINOBI_AUDIT_LOG_PATH;
      else process.env.SHINOBI_AUDIT_LOG_PATH = prevAudit;
    }
  }
}
