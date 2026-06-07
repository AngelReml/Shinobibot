// src/tools/synthesize_skill.ts
//
// Tool E2: el agente sintetiza una nueva SKILL verificada (E1), auditada y
// firmada (SHA256), y la deja en skills/pending/ para aprobación humana. Nunca
// la activa sola — pending requiere visto bueno. Ver agents/capability_factory.ts.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { synthesizeSkill } from '../agents/capability_factory.js';
import { invokeLLM as routedInvokeLLM } from '../providers/provider_router.js';
import type { LLMInvoker } from '../agents/agent_loop.js';

let _invoker: LLMInvoker = routedInvokeLLM;
/** Solo para tests: sustituye el LLM (productor y verificador). */
export function __setSkillFactoryInvokerForTest(fn: LLMInvoker | null): void {
  _invoker = fn ?? routedInvokeLLM;
}

// Override de dir de pending para tests (evita escribir en el repo real).
let _pendingDir: string | undefined;
/** Solo para tests: redirige el dir de pending. */
export function __setSkillFactoryPendingDirForTest(dir: string | null): void {
  _pendingDir = dir ?? undefined;
}

const synthesizeSkillTool: Tool = {
  name: 'synthesize_skill',
  description:
    'Crea una nueva SKILL (instrucciones reutilizables) a partir de un objetivo. ' +
    'La skill se VERIFICA por un revisor, pasa controles de seguridad (sin ' +
    'secretos ni comandos destructivos) y se FIRMA antes de quedar en pending ' +
    'para tu aprobación. Úsalo cuando detectes un procedimiento repetible que ' +
    'valga la pena guardar como capacidad.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Para qué debe servir la skill (objetivo claro).' },
      examples: { type: 'string', description: 'Opcional: ejemplos o contexto que guíen la síntesis.' },
    },
    required: ['goal'],
  },
  categories: ['coder'],

  async execute(args: { goal?: string; examples?: string }): Promise<ToolResult> {
    const goal = (args.goal ?? '').trim();
    if (!goal) return { success: false, output: '', error: 'synthesize_skill requiere "goal".' };

    const res = await synthesizeSkill({
      goal,
      examples: args.examples,
      pendingDir: _pendingDir,
      invokeLLM: _invoker,
      verifyInvokeLLM: _invoker,
    });

    if (!res.ok) {
      return {
        success: false,
        output: '',
        error: `No se pudo crear la skill (motivo: ${res.reason}). No se escribió nada.`,
      };
    }
    return {
      success: true,
      output:
        `Skill "${res.name}" sintetizada, verificada y firmada (sha256=${res.signatureHash?.slice(0, 12)}…). ` +
        `Queda PENDIENTE de tu aprobación${res.path ? ` en ${res.path}` : ''}.`,
    };
  },
};

registerTool(synthesizeSkillTool);
export default synthesizeSkillTool;
