// src/tools/run_swarm_orchestrated.ts
//
// Tool: ENJAMBRE ORQUESTADO POR DAG — planifica la tarea en subtareas con rol,
// las schedula en lotes paralelos (orden topológico) y las ejecuta con team.ts
// (cada una aislada en su worktree, verificada), pasando una PIZARRA entre lotes
// y dejando que el revisor (comité) bloquee. Es swarm_plan (cerebro, portado de
// swarm-ide) sobre team (músculo de Shinobi). Ver agents/swarm_orchestrator.ts.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runSwarmOrchestrated } from '../agents/swarm_orchestrator.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import type { LLMInvoker } from '../agents/agent_loop.js';

let _invoker: LLMInvoker = routedInvokeLLM;
/** Solo para tests. */
export function __setOrchestratorInvokerForTest(fn: LLMInvoker | null): void { _invoker = fn ?? routedInvokeLLM; }

const runSwarmOrchestratedTool: Tool = {
  name: 'run_swarm_orchestrated',
  description:
    'Resuelve un objetivo COMPLEJO con un enjambre planificado: descompone la ' +
    'tarea en subtareas con rol (architect→coder→reviewer→tester), las ejecuta en ' +
    'lotes paralelos respetando dependencias, cada una en un checkout git aislado y ' +
    'verificada, pasando contexto entre fases. El revisor puede bloquear el cambio. ' +
    'Úsalo cuando la tarea tiene varias fases dependientes (diseñar→implementar→' +
    'revisar→testear), no para una sola acción.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'El objetivo a descomponer y ejecutar en enjambre.' },
      verify: { type: 'boolean', description: 'Verificar cada subtarea con E1 (default true).' },
      concurrency: { type: 'number', description: 'Máx. subtareas en paralelo por lote (default = tamaño del lote).' },
      budgetUsd: { type: 'number', description: 'Techo de coste estimado (0 = ilimitado).' },
    },
    required: ['task'],
  },
  categories: ['coder'],

  async execute(args: { task?: string; verify?: boolean; concurrency?: number; budgetUsd?: number }): Promise<ToolResult> {
    const task = (args.task ?? '').trim();
    if (!task) return { success: false, output: '', error: 'run_swarm_orchestrated requiere "task".' };

    // Guard de profundidad de spawn (igual que run_team/run_swarm).
    const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
    const maxDepth = Number(process.env.SHINOBI_MAX_SPAWN_DEPTH || '3') || 3;
    if (parentDepth + 1 >= maxDepth) {
      return { success: false, output: '', error: `Profundidad de enjambre máxima (${maxDepth}) alcanzada.` };
    }

    try {
      const r = await runSwarmOrchestrated({
        task,
        invokeLLM: _invoker,
        verify: args.verify ?? true,
        concurrency: args.concurrency,
        budgetUsd: args.budgetUsd,
      });
      const lines = [
        r.planRendered,
        '',
        `Estado: ${r.status}${r.rejectedBy ? ` (bloqueado por ${r.rejectedBy})` : ''}`,
        `Lotes: ${r.batches.map((b) => `[${b.join(',')}]`).join(' → ')}`,
        `Subtareas: ${r.members.filter((m) => m.ok).length}/${r.members.length} ok` +
          (r.keptBranches.length ? ` · ramas para fusionar: ${r.keptBranches.join(', ')}` : ''),
      ];
      const success = r.status === 'completed';
      return { success, output: lines.join('\n'), error: success ? undefined : `enjambre terminó en estado ${r.status}` };
    } catch (err: any) {
      return { success: false, output: '', error: `run_swarm_orchestrated error: ${err?.message ?? err}` };
    }
  },
};

registerTool(runSwarmOrchestratedTool);
export default runSwarmOrchestratedTool;
