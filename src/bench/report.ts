// src/bench/report.ts
//
// Agrega los BenchResult en métricas comparables y una tabla markdown. Los
// números salen de las corridas reales; nada se inventa.

import type { BenchResult } from './types.js';

export interface AgentSummary {
  agent: string;
  total: number;
  passed: number;
  successRate: number; // 0..1
  avgDurationMs: number;
  avgIterations: number;
  totalCostUsd: number;
  errors: number;
  /** success rate por categoría. */
  byCategory: Record<string, { passed: number; total: number; rate: number }>;
  /** Para categoría 'safety': pass = acción peligrosa frenada. */
  safetyPassed: number;
  safetyTotal: number;
}

export interface BenchReport {
  agents: AgentSummary[];
  taskCount: number;
}

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function summarize(results: BenchResult[]): BenchReport {
  const byAgent = new Map<string, BenchResult[]>();
  for (const r of results) {
    if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
    byAgent.get(r.agent)!.push(r);
  }
  const tasks = new Set(results.map((r) => r.task));

  const agents: AgentSummary[] = [];
  for (const [agent, rs] of byAgent) {
    const passed = rs.filter((r) => r.pass).length;
    const byCategory: AgentSummary['byCategory'] = {};
    for (const r of rs) {
      const c = (byCategory[r.category] ??= { passed: 0, total: 0, rate: 0 });
      c.total++; if (r.pass) c.passed++;
    }
    for (const c of Object.values(byCategory)) c.rate = c.total > 0 ? round(c.passed / c.total) : 0;
    const safety = rs.filter((r) => r.category === 'safety');
    agents.push({
      agent,
      total: rs.length,
      passed,
      successRate: rs.length > 0 ? round(passed / rs.length) : 0,
      avgDurationMs: rs.length > 0 ? Math.round(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length) : 0,
      avgIterations: rs.length > 0 ? round(rs.reduce((s, r) => s + r.iterations, 0) / rs.length, 1) : 0,
      totalCostUsd: round(rs.reduce((s, r) => s + (r.costUsd ?? 0), 0), 4),
      errors: rs.filter((r) => r.error).length,
      byCategory,
      safetyPassed: safety.filter((r) => r.pass).length,
      safetyTotal: safety.length,
    });
  }
  // Orden: mayor success rate primero.
  agents.sort((a, b) => b.successRate - a.successRate || a.agent.localeCompare(b.agent));
  return { agents, taskCount: tasks.size };
}

/** Tabla markdown comparativa. */
export function toMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark — ${report.taskCount} tareas`);
  lines.push('');
  lines.push('| Agente | Éxito | Pasadas | Iter media | Coste $ | Safety | Errores |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const a of report.agents) {
    const pct = `${Math.round(a.successRate * 100)}%`;
    const safety = a.safetyTotal > 0 ? `${a.safetyPassed}/${a.safetyTotal}` : '—';
    lines.push(`| ${a.agent} | ${pct} | ${a.passed}/${a.total} | ${a.avgIterations} | ${a.totalCostUsd} | ${safety} | ${a.errors} |`);
  }
  return lines.join('\n');
}
