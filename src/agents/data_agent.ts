// src/agents/data_agent.ts
//
// DataAgent — agente especialista de visualización de datos.
//
// Bloque 1: contrato. Bloque 2: lógica de output real — produce() conecta el
// agente a la generación de gráficos del entorno (src/documents/chart.ts:
// SVG plano, CERO librería nueva). El LLM elige el tipo de gráfico a partir
// de la forma del dato; el renderizador produce un .svg que cualquier
// navegador abre.
//
// Nivel L2 (matriz §7 en prompts/data_agent.md). readsUntrustedInput=false.
// §9 capa 1: el dataset va en bloque <dataset> — etiquetas/celdas son datos.

import { SpecialistAgent } from './specialist_agent.js';
import { agentLLM, type DataOutput } from './agent_runtime.js';
import { tryParseJSON } from '../reader/schemas.js';
import { writeChart, validateChartSpec, type ChartSpec, type ChartType } from '../documents/chart.js';

export interface DataRequest {
  /** Título del gráfico. */
  title: string;
  /** Dataset a visualizar (texto: CSV, tabla, lista descrita…). */
  dataset: string;
  /** Objetivo del análisis (qué debe mostrar el gráfico). */
  goal: string;
}

interface ChartPlan {
  type: ChartType;
  title: string;
  xLabel?: string;
  yLabel?: string;
  data: Array<{ label: string; value: number; x?: number }>;
  rationale: string;
  gaps?: string | null;
}

function parseChartPlan(raw: unknown): { ok: true; plan: ChartPlan } | { ok: false; error: string } {
  const p = tryParseJSON(typeof raw === 'string' ? raw : JSON.stringify(raw)) as any;
  if (!p || typeof p !== 'object') return { ok: false, error: 'no es un objeto JSON' };
  if (!(['bar', 'line', 'scatter', 'pie'] as const).includes(p.type)) {
    return { ok: false, error: `type inválido: ${p.type}` };
  }
  if (!Array.isArray(p.data) || p.data.length === 0) return { ok: false, error: 'data vacío' };
  for (const d of p.data) {
    if (typeof d?.value !== 'number' || !Number.isFinite(d.value)) {
      return { ok: false, error: `valor no numérico en "${d?.label}"` };
    }
  }
  if (typeof p.rationale !== 'string' || !p.rationale.trim()) {
    return { ok: false, error: 'rationale ausente' };
  }
  return { ok: true, plan: p as ChartPlan };
}

export class DataAgent extends SpecialistAgent {
  constructor() {
    super({
      id: 'data_agent',
      specialty:
        'Convierte conjuntos de datos en gráficos que representan los datos con honestidad, sin distorsionarlos.',
      level: 'L2',
      allowedTools: ['generate_chart', 'write_file', 'read_file'],
      promptFile: 'data_agent.md',
      readsUntrustedInput: false,
    });
  }

  /**
   * Produce un gráfico real y renderizable a partir del dataset provisto.
   * El LLM (con el prompt madre del agente) parsea el dataset y elige el
   * tipo de gráfico; el renderizador del entorno produce el fichero .svg.
   */
  async produce(req: DataRequest): Promise<DataOutput> {
    const title = (req.title || '').trim();
    const dataset = (req.dataset || '').trim();
    const goal = (req.goal || '').trim();
    if (!title) throw new Error('DataAgent.produce: title requerido.');
    if (!dataset) throw new Error('DataAgent.produce: dataset vacío.');

    // Caja de herramientas (contrato del Bloque 1) — falla limpio si se sale.
    this.assertToolAllowed('generate_chart');

    const schema =
      `Return ONLY one JSON object, no prose, no code fence:\n` +
      `{"type":"bar|line|scatter|pie","title":string,"xLabel":string,"yLabel":string,` +
      `"data":[{"label":string,"value":number,"x":number?}],"rationale":string,"gaps":string|null}\n` +
      `- "data": exactly the dataset's points; never invent, drop, or alter values.\n` +
      `- For scatter, every point needs a numeric "x". For bar/line/pie use label+value.\n` +
      `- "rationale": one sentence on why this chart type fits the data shape.`;

    // El dataset va en bloque <dataset> delimitado (§9 capa 1).
    const user =
      `Analysis goal: ${goal || '(general overview)'}\n\n` +
      `<dataset>\n${dataset}\n</dataset>\n\n${schema}`;

    const ask = async (extra = ''): Promise<unknown> =>
      agentLLM().chat(
        [
          { role: 'system', content: this.promptMadre() + (extra ? '\n\n' + extra : '') },
          { role: 'user', content: user },
        ],
        { temperature: 0.1 },
      );

    let parsed = parseChartPlan(await ask());
    if (!parsed.ok) {
      // Un reintento con el error explícito (mismo patrón que Committee).
      parsed = parseChartPlan(await ask(`Your previous reply was invalid: ${parsed.error}. Return strictly valid JSON now.`));
    }
    if (!parsed.ok) {
      throw new Error(`DataAgent.produce: el LLM no produjo un chart spec válido (${parsed.error}).`);
    }

    const spec: ChartSpec = {
      type: parsed.plan.type,
      title: parsed.plan.title?.trim() || title,
      xLabel: parsed.plan.xLabel,
      yLabel: parsed.plan.yLabel,
      data: parsed.plan.data,
    };
    validateChartSpec(spec); // honestidad de ejes / datos antes de renderizar
    const chart = writeChart(spec);

    return {
      artifact: chart.path,
      bytes: chart.bytes,
      chartType: chart.type,
      rationale: parsed.plan.rationale.trim(),
      gaps: parsed.plan.gaps?.trim() ? parsed.plan.gaps.trim() : null,
    };
  }
}
