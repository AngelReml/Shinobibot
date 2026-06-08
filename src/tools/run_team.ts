// src/tools/run_team.ts
//
// Tool: lanza un EQUIPO de subagentes que MUTAN ficheros EN PARALELO, cada uno
// aislado en su propio worktree+contexto (sin pisarse). Cada miembro con cambios
// deja su rama para fusionar. Ver agents/team.ts.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runTeam, type TeamTask } from '../agents/team.js';
import { WorktreeManager } from '../agents/worktree.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import type { LLMInvoker } from '../agents/agent_loop.js';

let _invoker: LLMInvoker = routedInvokeLLM;
let _manager: WorktreeManager | undefined;
/** Solo para tests. */
export function __setTeamInvokerForTest(fn: LLMInvoker | null): void { _invoker = fn ?? routedInvokeLLM; }
export function __setTeamManagerForTest(m: WorktreeManager | null): void { _manager = m ?? undefined; }

const runTeamTool: Tool = {
  name: 'run_team',
  description:
    'Lanza varios subagentes que ESCRIBEN ficheros EN PARALELO, cada uno en un ' +
    'checkout git aislado (no se pisan). Úsalo para construir/modificar varias ' +
    'cosas independientes a la vez (p. ej. implementar 3 ficheros distintos). ' +
    'Cada miembro con cambios deja una rama para fusionar. run_command queda ' +
    'excluido (no se confina con el contexto).',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Sub-tareas: {task, tools?, criteria?}.',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            tools: { type: 'array', items: { type: 'string' } },
            criteria: { type: 'string' },
          },
          required: ['task'],
        },
      },
      concurrency: { type: 'number', description: 'Máx. miembros a la vez (default = nº tareas).' },
      verify: { type: 'boolean', description: 'Verificar cada resultado (E1). Default false.' },
    },
    required: ['tasks'],
  },
  categories: ['coder'],

  async execute(args: { tasks?: Array<{ task?: string; tools?: string[]; criteria?: string }>; concurrency?: number; verify?: boolean }): Promise<ToolResult> {
    const tasks: TeamTask[] = (Array.isArray(args.tasks) ? args.tasks : [])
      .filter((t) => t && typeof t.task === 'string' && t.task.trim())
      .map((t, i) => ({ task: t.task!.trim(), label: `member-${i}`, tools: t.tools, criteria: t.criteria }));
    if (tasks.length === 0) {
      return { success: false, output: '', error: 'run_team requiere al menos una tarea con "task".' };
    }

    const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
    const maxDepth = Number(process.env.SHINOBI_MAX_SPAWN_DEPTH || '3') || 3;
    if (parentDepth + 1 >= maxDepth) {
      return { success: false, output: '', error: `Profundidad de spawn máxima (${parentDepth + 1}/${maxDepth}); no se lanza el equipo.` };
    }

    const prevDepth = process.env.SHINOBI_SPAWN_DEPTH;
    process.env.SHINOBI_SPAWN_DEPTH = String(parentDepth + 1);
    let result;
    try {
      result = await runTeam({
        tasks,
        manager: _manager,
        concurrency: typeof args.concurrency === 'number' ? args.concurrency : undefined,
        verify: !!args.verify,
        invokeLLM: _invoker,
        verifyInvokeLLM: _invoker,
      });
    } finally {
      if (prevDepth === undefined) delete process.env.SHINOBI_SPAWN_DEPTH;
      else process.env.SHINOBI_SPAWN_DEPTH = prevDepth;
    }

    const lines = result.results.map((r) =>
      `- ${r.label}: ${r.ok ? 'OK' : 'FALLO'}${r.kept ? ` → rama ${r.branch}` : ''}${r.error ? ` (${r.error})` : ''}`);
    const merge = result.keptBranches.length > 0
      ? `\nRamas a fusionar: ${result.keptBranches.join(', ')}`
      : '';
    return {
      success: result.succeeded > 0,
      output: `Equipo: ${result.succeeded}/${result.total} OK.\n${lines.join('\n')}${merge}`,
      error: result.succeeded === 0 ? 'Ningún miembro del equipo tuvo éxito.' : undefined,
    };
  },
};

registerTool(runTeamTool);
export default runTeamTool;
