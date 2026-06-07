// src/tools/run_swarm.ts
//
// Tool E4: el agente lanza un ENJAMBRE de subagentes para sub-tareas
// independientes, en paralelo (concurrencia acotada), con verificación opcional.
// Ver agents/swarm.ts.
//
// Seguridad: como los subagentes corren sin gate de aprobación y en paralelo
// (cwd global), esta tool v1 es para trabajo NO mutante: filtra las tools
// destructivas de cada caja y NO ofrece worktree/sandbox (eso es secuencial,
// vía spawn_agent). Profundidad de spawn acotada (anti-recursión).

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runSwarm, type SwarmTask } from '../agents/swarm.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';
import type { LLMInvoker } from '../agents/agent_loop.js';

const DEFAULT_BOX = ['read_file', 'list_dir', 'search_files'];

let _invoker: LLMInvoker = routedInvokeLLM;
/** Solo para tests: sustituye el LLM de los subagentes del enjambre. */
export function __setSwarmInvokerForTest(fn: LLMInvoker | null): void {
  _invoker = fn ?? routedInvokeLLM;
}

const runSwarmTool: Tool = {
  name: 'run_swarm',
  description:
    'Lanza varios subagentes EN PARALELO, uno por sub-tarea, y agrega sus ' +
    'resultados. Útil para descomponer un objetivo en partes independientes ' +
    '(investigar varios temas, analizar varios ficheros). Trabajo de SOLO ' +
    'lectura/análisis (las herramientas destructivas se excluyen). Para tareas ' +
    'que escriben ficheros usa spawn_agent con isolation=worktree.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Lista de sub-tareas. Cada una: {task, tools?, criteria?}.',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'La sub-tarea.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Caja de tools (se filtran las destructivas).' },
            criteria: { type: 'string', description: 'Criterios de aceptación (modo verify).' },
          },
          required: ['task'],
        },
      },
      concurrency: { type: 'number', description: 'Máx. subagentes a la vez (default min(4, nº tareas)).' },
      verify: { type: 'boolean', description: 'Si true, cada resultado pasa por auto-verificación (E1). Default false.' },
    },
    required: ['tasks'],
  },
  categories: ['research', 'coder'],

  async execute(args: { tasks?: Array<{ task?: string; tools?: string[]; criteria?: string }>; concurrency?: number; verify?: boolean }): Promise<ToolResult> {
    const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
    const tasks: SwarmTask[] = rawTasks
      .filter((t) => t && typeof t.task === 'string' && t.task.trim())
      .map((t, i) => ({
        task: t.task!.trim(),
        label: `swarm-${i}`,
        // Filtra destructivas (subagentes sin gate, en paralelo).
        tools: (Array.isArray(t.tools) && t.tools.length > 0 ? t.tools : DEFAULT_BOX).filter((x) => !DESTRUCTIVE_TOOLS.has(x)),
        criteria: t.criteria,
      }));

    if (tasks.length === 0) {
      return { success: false, output: '', error: 'run_swarm requiere al menos una tarea con "task".' };
    }

    // Profundidad de spawn acotada (anti-recursión).
    const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
    const maxDepth = Number(process.env.SHINOBI_MAX_SPAWN_DEPTH || '3') || 3;
    if (parentDepth + 1 >= maxDepth) {
      return { success: false, output: '', error: `Profundidad de spawn máxima (${parentDepth + 1}/${maxDepth}); no se lanza el enjambre.` };
    }

    const prevDepthEnv = process.env.SHINOBI_SPAWN_DEPTH;
    process.env.SHINOBI_SPAWN_DEPTH = String(parentDepth + 1);
    let result;
    try {
      result = await runSwarm({
        tasks,
        concurrency: typeof args.concurrency === 'number' ? args.concurrency : undefined,
        verify: !!args.verify,
        invokeLLM: _invoker,
        verifyInvokeLLM: _invoker,
      });
    } finally {
      if (prevDepthEnv === undefined) delete process.env.SHINOBI_SPAWN_DEPTH;
      else process.env.SHINOBI_SPAWN_DEPTH = prevDepthEnv;
    }

    const lines = result.results.map((r) => `- ${r.label}: ${r.ok ? 'OK' : 'FALLO'}${r.error ? ` (${r.error})` : ''}`);
    const header = `Enjambre: ${result.succeeded}/${result.total} tareas OK.`;
    return {
      success: result.succeeded > 0,
      output: [header, ...lines, '', ...result.results.filter((r) => r.ok).map((r) => `### ${r.label}\n${r.output}`)].join('\n'),
      error: result.succeeded === 0 ? 'Ninguna tarea del enjambre tuvo éxito.' : undefined,
    };
  },
};

registerTool(runSwarmTool);
export default runSwarmTool;
