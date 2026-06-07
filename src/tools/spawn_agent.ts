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
import { runAgentLoop, type LLMInvoker } from '../agents/agent_loop.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';

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
  }): Promise<ToolResult> {
    const task = (args.task ?? '').trim();
    if (!task) {
      return { success: false, output: '', error: 'spawn_agent requiere "task".' };
    }

    const requested = Array.isArray(args.tools) && args.tools.length > 0 ? args.tools : DEFAULT_BOX;
    // Mínimo privilegio + seguridad: el subagente corre sin gate de aprobación,
    // así que se le retiran las tools destructivas de la caja.
    const stripped = requested.filter((t) => DESTRUCTIVE_TOOLS.has(t));
    const box = requested.filter((t) => !DESTRUCTIVE_TOOLS.has(t));

    // Profundidad: el hijo está un nivel por debajo del actual. Se publica en
    // env durante su ejecución para que un spawn_agent anidado vea su nivel
    // (save/restore: correcto para anidamiento secuencial; la orquestación
    // paralela usará un mecanismo sin env cuando se construya Team).
    const parentDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
    const childDepth = parentDepth + 1;
    const label = (args.label ?? `sub-${childDepth}`).trim() || `sub-${childDepth}`;

    const prevDepthEnv = process.env.SHINOBI_SPAWN_DEPTH;
    process.env.SHINOBI_SPAWN_DEPTH = String(childDepth);
    let result;
    try {
      result = await runAgentLoop({
        task,
        systemPrompt: (args.system_prompt ?? '').trim() || DEFAULT_SYSTEM_PROMPT,
        tools: box,
        depth: childDepth,
        label,
        maxIterations: typeof args.max_iterations === 'number' ? args.max_iterations : undefined,
        invokeLLM: _invoker,
      });
    } finally {
      if (prevDepthEnv === undefined) delete process.env.SHINOBI_SPAWN_DEPTH;
      else process.env.SHINOBI_SPAWN_DEPTH = prevDepthEnv;
    }

    const usedLine = result.toolsUsed.length > 0 ? ` (tools: ${result.toolsUsed.join(', ')})` : '';
    const strippedNote = stripped.length > 0
      ? `\n[nota: herramientas destructivas excluidas de la caja: ${stripped.join(', ')}]`
      : '';
    const header = `Subagente "${label}" → ${result.verdict} en ${result.iterations} iter${usedLine}.${strippedNote}`;

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
