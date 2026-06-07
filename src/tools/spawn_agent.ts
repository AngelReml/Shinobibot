// src/tools/spawn_agent.ts
//
// Tool de DELEGACIÓN: el agente principal crea un subagente acotado para una
// tarea concreta. Equivale al AgentTool de los agentes de primera línea, pero
// con la espina de confianza de shinobi:
//   - caja de tools de MÍNIMO PRIVILEGIO (allowlist),
//   - tools DESTRUCTIVAS filtradas por defecto (el subagente corre desatendido,
//     sin el gate de aprobación del orchestrator → no puede hacer nada
//     irreversible sin supervisión: autonomía SEGURA por diseño),
//   - profundidad de spawn acotada (anti-recursión infinita),
//   - loop detector v3 + audit JSONL heredados (vía agent_loop).
//
// Ver agent_loop.ts (el motor) y el plan competitivo (motores E2/E4).

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runAgentLoop, type AgentLoopResult, type LLMInvoker } from '../agents/agent_loop.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';
import { WorktreeManager, withWorktree } from '../agents/worktree.js';

// Tools destructivas que SÍ son seguras bajo aislamiento por worktree porque
// validatePath las confina a WORKSPACE_ROOT (= el worktree desechable).
const WORKTREE_SAFE = new Set(['write_file', 'edit_file']);

// Tools destructivas que SÍ son seguras cuando hay un SANDBOX de ejecución
// activo (docker/e2b): run_command corre en un contenedor efímero (red off,
// solo el cwd montado), no en el host. El resto (screen_act, cloud_mission,
// task_scheduler…) NO se sandboxean con el contenedor → siguen bloqueadas.
const SANDBOX_SAFE = new Set(['run_command']);

export type SandboxMode = 'none' | 'docker' | 'e2b';

const DEFAULT_SYSTEM_PROMPT =
  'Eres un subagente de shinobi enfocado en UNA tarea concreta. Trabaja solo con ' +
  'las herramientas de tu caja. Sé conciso y directo. Cuando termines, responde ' +
  'con el RESULTADO final en texto plano (sin más llamadas a herramientas).';

// Caja por defecto: solo lectura local. Segura para un subagente desatendido.
const DEFAULT_BOX = ['read_file', 'list_dir', 'search_files'];

// Inyector de LLM (override en test). Por defecto el provider router con failover.
let _invoker: LLMInvoker = routedInvokeLLM;
/** Solo para tests: sustituye el invocador de LLM que usan los subagentes. */
export function __setSpawnInvokerForTest(fn: LLMInvoker | null): void {
  _invoker = fn ?? routedInvokeLLM;
}

// Mánager de worktrees (override en test). Lazy: usa el repo del cwd actual.
let _wtManager: WorktreeManager | null = null;
function worktreeManager(): WorktreeManager {
  if (!_wtManager) _wtManager = new WorktreeManager();
  return _wtManager;
}
/** Solo para tests: sustituye el mánager de worktrees. */
export function __setWorktreeManagerForTest(m: WorktreeManager | null): void {
  _wtManager = m;
}

const spawnAgent: Tool = {
  name: 'spawn_agent',
  description:
    'Crea un SUBAGENTE acotado para resolver una sub-tarea concreta de forma ' +
    'aislada, con su propia caja de herramientas (mínimo privilegio) y su propio ' +
    'presupuesto de iteraciones. Devuelve el resultado del subagente. Útil para ' +
    'descomponer un objetivo grande, paralelizar trabajo, o aislar una tarea ' +
    'arriesgada. Las herramientas destructivas se excluyen automáticamente de la ' +
    'caja del subagente (corre desatendido). Pásale solo las herramientas que ' +
    'necesite.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'La sub-tarea que debe resolver el subagente (su instrucción).',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Allowlist de nombres de herramientas que el subagente podrá usar ' +
          '(mínimo privilegio). Si se omite, se usa una caja de solo lectura ' +
          'local (read_file, list_dir, search_files).',
      },
      system_prompt: {
        type: 'string',
        description: 'Opcional: instrucciones/persona del subagente. Si se omite, una genérica.',
      },
      max_iterations: {
        type: 'number',
        description: 'Opcional: tope de iteraciones del subagente (default 8).',
      },
      label: {
        type: 'string',
        description: 'Opcional: etiqueta del subagente para correlación en el audit.',
      },
      isolation: {
        type: 'string',
        enum: ['none', 'worktree'],
        description:
          'Opcional. "worktree": el subagente trabaja en un checkout git aislado ' +
          '(desechable). En ese modo se le PERMITEN las tools de escritura de ' +
          'ficheros (write_file/edit_file), confinadas al worktree. Si hace ' +
          'cambios, el worktree se conserva (rama propia) para fusionar; si no, ' +
          'se descarta. Default "none".',
      },
      sandbox: {
        type: 'string',
        enum: ['none', 'docker', 'e2b'],
        description:
          'Opcional. Sandbox de EJECUCIÓN para el subagente. "docker": run_command ' +
          'corre en un contenedor efímero (sin red, solo el cwd montado). "e2b": ' +
          'sandbox cloud (requiere E2B_API_KEY). En estos modos se PERMITE ' +
          'run_command (aislado del host). Si el backend no está disponible, falla ' +
          'en vez de ejecutar en el host. Default "none".',
      },
    },
    required: ['task'],
  },
  categories: ['coder', 'research'],

  async execute(args: {
    task?: string;
    tools?: string[];
    system_prompt?: string;
    max_iterations?: number;
    label?: string;
    isolation?: 'none' | 'worktree';
    sandbox?: SandboxMode;
  }): Promise<ToolResult> {
    const task = (args.task ?? '').trim();
    if (!task) {
      return { success: false, output: '', error: 'spawn_agent requiere "task".' };
    }

    const isolation = args.isolation === 'worktree' ? 'worktree' : 'none';
    const sandbox: SandboxMode = args.sandbox === 'docker' || args.sandbox === 'e2b' ? args.sandbox : 'none';

    // Validación fail-loud del sandbox ANTES de tocar nada: si se pidió un
    // backend que no está disponible/configurado, NO se ejecuta en el host.
    if (sandbox === 'docker') {
      const { isDockerAvailable } = await import('./_docker_backend.js');
      const d = await isDockerAvailable();
      if (!d.available) {
        return {
          success: false, output: '',
          error: `sandbox="docker" no disponible (${d.error ?? 'docker daemon caído'}). ` +
            `No se ejecuta en el host por seguridad.`,
        };
      }
    } else if (sandbox === 'e2b') {
      const { sandboxRegistry } = await import('../sandbox/registry.js');
      const b = sandboxRegistry().get('e2b');
      if (!b || !b.isConfigured()) {
        return {
          success: false, output: '',
          error: 'sandbox="e2b" no configurado (define E2B_API_KEY). No se ejecuta en el host por seguridad.',
        };
      }
    }

    const requested = Array.isArray(args.tools) && args.tools.length > 0 ? args.tools : DEFAULT_BOX;
    // Mínimo privilegio + seguridad: el subagente corre sin gate de aprobación,
    // así que se le retiran las tools destructivas de la caja. Cada modo de
    // aislamiento DESBLOQUEA el subconjunto que vuelve a ser seguro bajo él:
    //   - worktree → escrituras de fichero confinadas (write_file/edit_file)
    //   - sandbox  → ejecución de comandos aislada (run_command)
    const unlocked = new Set<string>();
    if (isolation === 'worktree') for (const t of WORKTREE_SAFE) unlocked.add(t);
    if (sandbox !== 'none') for (const t of SANDBOX_SAFE) unlocked.add(t);
    const isBlocked = (t: string) => DESTRUCTIVE_TOOLS.has(t) && !unlocked.has(t);
    const stripped = requested.filter(isBlocked);
    const box = requested.filter((t) => !isBlocked(t));

    // Profundidad: el hijo está un nivel por debajo del actual. Se publica en
    // env durante su ejecución para que un spawn_agent anidado vea su nivel
    // (save/restore: correcto para anidamiento secuencial; la orquestación
    // paralela usará un mecanismo sin env cuando se construya Team).
    const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
    const childDepth = parentDepth + 1;
    const label = (args.label ?? `sub-${childDepth}`).trim() || `sub-${childDepth}`;

    const runLoop = (): Promise<AgentLoopResult> => runAgentLoop({
      task,
      systemPrompt: (args.system_prompt ?? '').trim() || DEFAULT_SYSTEM_PROMPT,
      tools: box,
      depth: childDepth,
      label,
      maxIterations: typeof args.max_iterations === 'number' ? args.max_iterations : undefined,
      invokeLLM: _invoker,
    });

    const prevDepthEnv = process.env.SHINOBI_SPAWN_DEPTH;
    process.env.SHINOBI_SPAWN_DEPTH = String(childDepth);
    // Sandbox de ejecución: el subagente routea run_command al backend pedido.
    // Save/restore (global al proceso → correcto para el anidamiento secuencial,
    // como la profundidad; el paralelo real lo cubrirá Team).
    const prevBackendEnv = process.env.SHINOBI_RUN_BACKEND;
    if (sandbox !== 'none') process.env.SHINOBI_RUN_BACKEND = sandbox;
    let result: AgentLoopResult;
    let worktreeNote = '';
    try {
      if (isolation === 'worktree') {
        const mgr = worktreeManager();
        if (!mgr.isGitRepo()) {
          return {
            success: false,
            output: '',
            error: 'isolation="worktree" requiere que el directorio actual sea un repositorio git.',
          };
        }
        // El subagente corre con cwd + WORKSPACE_ROOT scoped al worktree; si deja
        // cambios, se conserva (rama propia) para fusionar; si no, se descarta.
        const wrapped = await withWorktree(mgr, label, async () => runLoop(), { keepIfChanged: true });
        result = wrapped.result;
        worktreeNote = wrapped.kept
          ? `\n[worktree conservado con cambios: rama ${wrapped.worktree.branch} → ${wrapped.worktree.path}]`
          : `\n[worktree descartado (sin cambios): ${wrapped.worktree.branch}]`;
      } else {
        result = await runLoop();
      }
    } finally {
      if (prevDepthEnv === undefined) delete process.env.SHINOBI_SPAWN_DEPTH;
      else process.env.SHINOBI_SPAWN_DEPTH = prevDepthEnv;
      if (prevBackendEnv === undefined) delete process.env.SHINOBI_RUN_BACKEND;
      else process.env.SHINOBI_RUN_BACKEND = prevBackendEnv;
    }

    const usedLine = result.toolsUsed.length > 0 ? ` (tools: ${result.toolsUsed.join(', ')})` : '';
    const strippedNote = stripped.length > 0
      ? `\n[nota: herramientas destructivas excluidas de la caja: ${stripped.join(', ')}]`
      : '';
    const sandboxNote = sandbox !== 'none' ? `\n[sandbox de ejecución: ${sandbox}]` : '';
    const header = `Subagente "${label}" → ${result.verdict} en ${result.iterations} iter${usedLine}.${strippedNote}${sandboxNote}${worktreeNote}`;

    if (!result.ok) {
      return {
        success: false,
        output: header,
        error: result.error || result.verdict,
      };
    }
    return { success: true, output: `${header}\n\n${result.output}` };
  },
};

registerTool(spawnAgent);
export default spawnAgent;
