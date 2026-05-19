/**
 * Specialist Agent Tools — cabo C de la FASE 2 del encargo "Refinador".
 *
 * Auditoría previa: los SpecialistAgents (Research/Docs/Data) tenían lógica
 * `produce()` validada pero NINGÚN punto de producción los invocaba — solo
 * los golden sets aislados. Pieza sin cablear.
 *
 * Estas tres tools cablean la delegación: el orchestrator, al ver una
 * petición de investigación / documento / gráfico, delega en el especialista
 * dedicado en vez de resolverla con tools sueltas. La selección la hace el
 * LLM del orchestrator por su tool-loop normal — no hay router rígido
 * (eso sería promover el clasificador del Bloque 3, que sigue en shadow).
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { ResearchAgent, DocsAgent, DataAgent } from '../agents/index.js';

const researchAgentTool: Tool = {
  name: 'research_agent_run',
  description:
    'Delegate a research or investigation task to the ResearchAgent specialist. Use this for ANY ' +
    'request to research, investigate, look up, find information, or explain something that must be ' +
    'looked up. ResearchAgent returns findings with verifiable cited sources. Prefer this over ' +
    'calling web_search directly — it is the dedicated specialist for research.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The research question or investigation request.' },
    },
    required: ['question'],
  },
  async execute(args: { question?: string }): Promise<ToolResult> {
    const question = typeof args?.question === 'string' ? args.question.trim() : '';
    if (!question) return { success: false, output: '', error: 'research_agent_run requires "question".' };
    const prevDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0');
    try {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth + 1);
      const r = await new ResearchAgent().produce(question);
      const lines = [
        `[delegado → ResearchAgent] valid=${r.valid}`,
        `Answer: ${r.answer}`,
        r.findings.length ? `Findings:\n${r.findings.map(f => `  - ${f}`).join('\n')}` : '',
        r.sources.length ? `Sources:\n${r.sources.map((s, i) => `  [${i + 1}] ${s.title} — ${s.url}`).join('\n')}` : '',
        `Confidence: ${r.confidence}`,
      ].filter(Boolean);
      return { success: r.valid, output: lines.join('\n'), error: r.valid ? undefined : 'sin fuentes verificables' };
    } catch (err: any) {
      return { success: false, output: '', error: `research_agent_run failed: ${err?.message ?? err}` };
    } finally {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth);
    }
  },
};

const docsAgentTool: Tool = {
  name: 'docs_agent_run',
  description:
    'Delegate a document-generation task to the DocsAgent specialist. Use this for ANY request to ' +
    'write a report, generate a document, produce a PDF or structured Markdown from given content. ' +
    'Returns a real, openable file. It is the dedicated specialist for documents.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title.' },
      content: { type: 'string', description: 'The content to format into the document (source of truth).' },
      format: { type: 'string', enum: ['pdf', 'markdown', 'word'], description: 'Output format. Default: markdown.' },
    },
    required: ['title', 'content'],
  },
  async execute(args: { title?: string; content?: string; format?: 'pdf' | 'markdown' | 'word' }): Promise<ToolResult> {
    if (!args?.title || !args?.content) {
      return { success: false, output: '', error: 'docs_agent_run requires "title" and "content".' };
    }
    const prevDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0');
    try {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth + 1);
      const r = await new DocsAgent().produce({ title: args.title, content: args.content, format: args.format });
      return {
        success: true,
        output: `[delegado → DocsAgent] ${r.format} generado: ${r.artifact} (${r.bytes} bytes). ` +
          `Estructura: ${r.structure}${r.gaps ? ` | GAPS: ${r.gaps}` : ''}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `docs_agent_run failed: ${err?.message ?? err}` };
    } finally {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth);
    }
  },
};

const dataAgentTool: Tool = {
  name: 'data_agent_run',
  description:
    'Delegate a data-visualization task to the DataAgent specialist. Use this for ANY request to ' +
    'chart, graph, plot, or visualize a dataset, or to analyze figures and turn them into a chart. ' +
    'Accepts numeric data pasted in natural language. Returns a real, rendered chart file.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Chart title.' },
      dataset: { type: 'string', description: 'The dataset to visualize (numbers in natural language are fine).' },
      goal: { type: 'string', description: 'What the chart should show / the analysis goal.' },
    },
    required: ['title', 'dataset'],
  },
  async execute(args: { title?: string; dataset?: string; goal?: string }): Promise<ToolResult> {
    if (!args?.title || !args?.dataset) {
      return { success: false, output: '', error: 'data_agent_run requires "title" and "dataset".' };
    }
    const prevDepth = Number(process.env.SHINOBI_SPAWN_DEPTH || '0');
    try {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth + 1);
      const r = await new DataAgent().produce({ title: args.title, dataset: args.dataset, goal: args.goal ?? '' });
      return {
        success: true,
        output: `[delegado → DataAgent] gráfico ${r.chartType} generado: ${r.artifact} (${r.bytes} bytes). ` +
          `${r.rationale}${r.gaps ? ` | GAPS: ${r.gaps}` : ''}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `data_agent_run failed: ${err?.message ?? err}` };
    } finally {
      process.env.SHINOBI_SPAWN_DEPTH = String(prevDepth);
    }
  },
};

registerTool(researchAgentTool);
registerTool(docsAgentTool);
registerTool(dataAgentTool);

export { researchAgentTool, docsAgentTool, dataAgentTool };
