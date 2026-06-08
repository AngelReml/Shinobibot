// src/tools/trust_report.ts
//
// Tool E3: expone los trust-scores por herramienta derivados del audit.jsonl.
// Deja que el agente (o el usuario) vea qué herramientas son fiables en la
// práctica — la señal que alimenta ranking/routing/curator. Ver
// audit/trust_ledger.ts.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { loadTrustReport } from '../audit/trust_ledger.js';

const trustReportTool: Tool = {
  name: 'trust_report',
  description:
    'Muestra la fiabilidad PROBADA de las herramientas, derivada del registro de ' +
    'auditoría (tasa de éxito, latencia media, modo de fallo dominante, score). ' +
    'Útil para decidir en qué herramienta confiar o diagnosticar cuál falla más. ' +
    'Read-only.',
  parameters: {
    type: 'object',
    properties: {
      top: { type: 'number', description: 'Cuántas herramientas listar (default 15).' },
      tool: { type: 'string', description: 'Opcional: filtrar a una herramienta concreta.' },
    },
  },
  categories: ['research'],

  async execute(args: { top?: number; tool?: string }): Promise<ToolResult> {
    const report = loadTrustReport();
    if (report.tools.length === 0) {
      return { success: true, output: 'Sin datos de auditoría todavía (audit.jsonl vacío o ausente).' };
    }
    let rows = report.tools;
    if (args.tool) {
      rows = rows.filter((r) => r.tool === args.tool);
      if (rows.length === 0) {
        return { success: true, output: `No hay registro de la herramienta "${args.tool}".` };
      }
    } else {
      const top = typeof args.top === 'number' && args.top > 0 ? args.top : 15;
      rows = rows.slice(0, top);
    }
    const lines = rows.map((r) => {
      const pct = Math.round(r.successRate * 100);
      const fail = r.topFailureMode ? ` [fallo dominante: ${r.topFailureMode}]` : '';
      return `- ${r.tool}: ${r.calls} llamadas, ${pct}% ok, ${r.avgDurationMs}ms avg, score ${r.score.toFixed(2)}${fail}`;
    });
    return {
      success: true,
      output: [`Trust report (de ${report.fromEvents} tool calls auditadas):`, ...lines].join('\n'),
    };
  },
};

registerTool(trustReportTool);
export default trustReportTool;
