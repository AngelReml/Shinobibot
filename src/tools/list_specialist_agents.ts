/**
 * ListSpecialistAgents Tool — introspección del subsistema de agentes.
 *
 * Expone los agentes especialistas registrados (Bloque 1) para que Shinobi
 * pueda responder "¿qué agentes especialistas hay y qué herramientas tiene
 * permitidas cada uno?". Tool de SOLO LECTURA — no instancia ni ejecuta nada.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { describeSpecialistAgents } from '../agents/index.js';

const listSpecialistAgentsTool: Tool = {
  name: 'list_specialist_agents',
  description:
    'List the specialist agents available in Shinobi and, for each one, its declared specialty, ' +
    'its prompt level (L1/L2/L3) and the closed list of tools it is allowed to use. ' +
    'Use this to answer questions about which specialist agents exist and what each can do.',
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(): Promise<ToolResult> {
    try {
      const agents = describeSpecialistAgents();
      const lines: string[] = [`Agentes especialistas registrados: ${agents.length}`];
      for (const a of agents) {
        lines.push('');
        lines.push(`• ${a.id} [${a.level}]`);
        lines.push(`  especialidad     : ${a.specialty}`);
        lines.push(`  herramientas     : ${a.allowedTools.join(', ')}`);
        lines.push(`  lee input externo: ${a.readsUntrustedInput ? 'sí (§9 capa 3: caja sin tools irreversibles)' : 'no'}`);
      }
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: `list_specialist_agents failed: ${err?.message ?? err}` };
    }
  },
};

registerTool(listSpecialistAgentsTool);
export default listSpecialistAgentsTool;
