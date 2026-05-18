/**
 * GenerateChart Tool — genera un gráfico (SVG) a partir de un spec.
 *
 * Bloque 2 del encargo multibloque. Es la herramienta de salida de DataAgent:
 * renderiza bar/line/scatter/pie a un fichero .svg que cualquier navegador
 * abre. CERO dependencia nueva — el renderizado es SVG plano (src/documents/
 * chart.ts).
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { writeChart, type ChartSpec, type ChartType } from '../documents/chart.js';

const generateChartTool: Tool = {
  name: 'generate_chart',
  description:
    'Render a data chart (bar, line, scatter, or pie) to an .svg file that opens in any browser. ' +
    'Use this when the user asks for a chart, graph, plot, or data visualization. ' +
    'Pass `type`, `title`, and `data` (an array of {label, value}; for scatter also {x}).',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['bar', 'line', 'scatter', 'pie'], description: 'Chart type.' },
      title: { type: 'string', description: 'Chart title.' },
      x_label: { type: 'string', description: 'X axis label (optional).' },
      y_label: { type: 'string', description: 'Y axis label (optional).' },
      data: {
        type: 'array',
        description: 'Data points: [{label, value, x?}]. `x` (number) only for scatter.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'number' },
            x: { type: 'number' },
          },
          required: ['label', 'value'],
        },
      },
    },
    required: ['type', 'title', 'data'],
  },

  async execute(args: {
    type: ChartType; title: string; x_label?: string; y_label?: string;
    data: Array<{ label: string; value: number; x?: number }>;
  }): Promise<ToolResult> {
    try {
      const spec: ChartSpec = {
        type: args.type,
        title: args.title,
        xLabel: args.x_label,
        yLabel: args.y_label,
        data: args.data,
      };
      const r = writeChart(spec);
      return {
        success: true,
        output: `Chart generated: ${r.path} (${r.type}, ${r.bytes} bytes). Opens in any browser.`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `generate_chart failed: ${err?.message ?? err}` };
    }
  },
};

registerTool(generateChartTool);
export default generateChartTool;
