// src/tools/run_team.ts
//
// Tool: lanza un EQUIPO de subagentes que MUTAN ficheros EN PARALELO, cada uno
// aislado en su propio worktree+contexto (sin pisarse). Cada miembro con cambios
// deja su rama para fusionar. Ver agents/team.ts.
//
// F2.8 (auditoría 2026-07) — filtro DESTRUCTIVE_TOOLS: a diferencia de
// run_swarm.ts (que filtra `DESTRUCTIVE_TOOLS` INLINE y visible en este
// mismo fichero, ver src/tools/run_swarm.ts), el filtro de este tool vive
// en `runTeam()` (src/agents/team.ts, líneas ~23-27 y ~118):
//
//   const WORKTREE_SAFE = new Set(['write_file', 'edit_file']);
//   const box = requested.filter((x) => !(DESTRUCTIVE_TOOLS.has(x) && !WORKTREE_SAFE.has(x)));
//
// Misma fuente (`DESTRUCTIVE_TOOLS` de src/security/approval.ts) que usa
// run_swarm — la diferencia real es que team.ts añade `WORKTREE_SAFE`:
// write_file/edit_file NO se bloquean aquí porque cada miembro del equipo
// escribe en su PROPIO worktree git aislado (confinado por
// exec_context.ts), así que mutar ficheros es justo el propósito de esta
// tool y es seguro — run_command SIGUE excluido siempre (un shell no se
// confina con el contexto). Este comentario existe para que la simetría con
// run_swarm sea evidente en revisión sin tener que saltar a otro fichero.
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runTeam, type TeamTask } from '../agents/team.js';
import { WorktreeManager } from '../agents/worktree.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import type { LLMInvoker } from '../agents/agent_loop.js';
import { getSpawnDepth, getMaxSpawnDepth, runWithSpawnDepth } from '../agents/spawn_depth.js';

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

    const parentDepth = getSpawnDepth();
    const maxDepth = getMaxSpawnDepth();
    if (parentDepth + 1 >= maxDepth) {
      return { success: false, output: '', error: `Profundidad de spawn máxima (${parentDepth + 1}/${maxDepth}); no se lanza el equipo.` };
    }

    const result = await runWithSpawnDepth(parentDepth + 1, () => runTeam({
      tasks,
      manager: _manager,
      concurrency: typeof args.concurrency === 'number' ? args.concurrency : undefined,
      verify: !!args.verify,
      invokeLLM: _invoker,
      verifyInvokeLLM: _invoker,
    }));

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
