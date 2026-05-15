/**
 * Benchmark Runner — suite comparativa de 20 tareas con scoring
 * objetivo para evaluar Shinobi vs Hermes vs OpenClaw (o cualquier
 * agente que implemente `AgentAdapter`).
 *
 * Diseño:
 *   - 20 tareas categorizadas: parsing, reasoning, planning, memory,
 *     tool-use, recovery (5 cat × 4 task aprox.).
 *   - Cada tarea define entrada + criterios de éxito CHECKABLES SIN LLM:
 *     regex sobre output, presencia de filenames, JSON match, etc.
 *   - El runner ejecuta cada tarea contra un AgentAdapter inyectado
 *     (en tests: mock; en CI: real agent).
 *   - Output: report con score normalizado por categoría + global,
 *     latencia, fallos.
 *
 * Diferenciador: ni Hermes ni OpenClaw publican un benchmark
 * reproducible. Esta suite ES el ground truth comparativo.
 */

export type TaskCategory = 'parsing' | 'reasoning' | 'planning' | 'memory' | 'tool_use' | 'recovery';

export interface BenchmarkTask {
  id: string;
  category: TaskCategory;
  prompt: string;
  /** Función pura que recibe el output del agente y devuelve true/false. */
  check: (output: string, meta?: { toolCalls?: string[]; durationMs?: number }) => boolean;
  /** Timeout sugerido en ms. */
  timeoutMs: number;
}

export interface AgentAdapter {
  name: string;
  run(task: BenchmarkTask): Promise<{
    output: string;
    toolCalls?: string[];
    durationMs: number;
    error?: string;
  }>;
}

export interface TaskResult {
  taskId: string;
  category: TaskCategory;
  ok: boolean;
  durationMs: number;
  error?: string;
  outputPreview: string;
}

export interface BenchmarkReport {
  agentName: string;
  startedAt: string;
  finishedAt: string;
  results: TaskResult[];
  scoreByCategory: Record<TaskCategory, { tasks: number; passed: number; score: number }>;
  globalScore: number;
  avgLatencyMs: number;
}

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // ── PARSING (4) ──
  {
    id: 'parse-json-extract',
    category: 'parsing',
    prompt: 'Extrae el campo "user.email" del JSON: {"user":{"email":"foo@bar.com","name":"x"}}',
    check: (out) => /foo@bar\.com/.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'parse-csv-row-count',
    category: 'parsing',
    prompt: 'Cuántas filas (sin header) tiene este CSV:\nname,age\nalice,30\nbob,40\ncarol,25',
    check: (out) => /\b3\b/.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'parse-version-bump',
    category: 'parsing',
    prompt: 'Dada la versión 1.2.3, devuelve la siguiente versión patch como string.',
    check: (out) => /\b1\.2\.4\b/.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'parse-yaml-key',
    category: 'parsing',
    prompt: 'YAML:\nname: alice\nrole: admin\nrole vale qué?',
    check: (out) => /admin/i.test(out),
    timeoutMs: 10_000,
  },

  // ── REASONING (4) ──
  {
    id: 'reason-arithmetic',
    category: 'reasoning',
    prompt: '¿Cuánto es 17 * 23 + 5?',
    check: (out) => /\b396\b/.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'reason-logic',
    category: 'reasoning',
    prompt: 'Si A→B y B→C y A es verdadero, ¿es C verdadero? Responde sí o no.',
    check: (out) => /(?:^|\W)s[ií](?:$|\W)/i.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'reason-string-reverse',
    category: 'reasoning',
    prompt: 'Invierte la cadena "shinobi" y devuélvela.',
    check: (out) => /ibonihs/i.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'reason-prime',
    category: 'reasoning',
    prompt: '¿Es 17 primo? Responde "sí" o "no".',
    check: (out) => /(?:^|\W)s[ií](?:$|\W)/i.test(out) && !/\bno\b/i.test(out),
    timeoutMs: 10_000,
  },

  // ── PLANNING (3) ──
  {
    id: 'plan-steps-ordered',
    category: 'planning',
    prompt: 'Plan en 3 pasos para crear un repo git: enumeralos numerados 1, 2, 3.',
    check: (out) => /1[.)]/.test(out) && /2[.)]/.test(out) && /3[.)]/.test(out),
    timeoutMs: 15_000,
  },
  {
    id: 'plan-deps',
    category: 'planning',
    prompt: 'Para hacer tea necesitas: agua hirviendo, taza, bolsita. Lista los pasos en orden de dependencia.',
    check: (out) => out.toLowerCase().indexOf('agua') < out.toLowerCase().indexOf('bolsita'),
    timeoutMs: 15_000,
  },
  {
    id: 'plan-priorities',
    category: 'planning',
    prompt: 'Si tienes 1 hora y 3 tareas (urgente, importante, opcional), ¿cuál haces primero?',
    check: (out) => /urgente/i.test(out),
    timeoutMs: 15_000,
  },

  // ── MEMORY (3) ──
  {
    id: 'memory-recall',
    category: 'memory',
    prompt: 'Recuerda: mi color favorito es violeta. ¿Cuál es mi color favorito?',
    check: (out) => /violeta/i.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'memory-contradiction',
    category: 'memory',
    prompt: 'Me llamo Pedro. Antes dije que me llamo Pablo. Detecta la contradicción.',
    check: (out) => /contradic|distint|cambio/i.test(out),
    timeoutMs: 10_000,
  },
  {
    id: 'memory-preference',
    category: 'memory',
    prompt: 'No me gusta el café. ¿Te ofrezco café?',
    check: (out) => /no\b.*café|otra cosa|té|infusión/i.test(out),
    timeoutMs: 10_000,
  },

  // ── TOOL USE (3) ──
  {
    id: 'tool-call-read',
    category: 'tool_use',
    prompt: 'Lee README.md y dime cuántas líneas tiene.',
    check: (out, m) => (m?.toolCalls?.some(t => /read/i.test(t)) ?? false) && /\d+/.test(out),
    timeoutMs: 30_000,
  },
  {
    id: 'tool-call-shell',
    category: 'tool_use',
    prompt: 'Ejecuta `node --version` y devuelve el output.',
    check: (out, m) => /v\d+\.\d+/i.test(out) && (m?.toolCalls?.some(t => /shell|run_command|exec/i.test(t)) ?? false),
    timeoutMs: 30_000,
  },
  {
    id: 'tool-chain',
    category: 'tool_use',
    prompt: 'Lee package.json, extrae la version y dime cuál es.',
    check: (out, m) => /\d+\.\d+\.\d+/.test(out) && (m?.toolCalls?.length ?? 0) >= 1,
    timeoutMs: 30_000,
  },

  // ── RECOVERY (3) ──
  {
    id: 'recovery-retry-after-fail',
    category: 'recovery',
    prompt: 'Si la primera tool call falla con ENOENT, ¿qué haces?',
    check: (out) => /reintent|verific|comprob|otra ruta/i.test(out),
    timeoutMs: 15_000,
  },
  {
    id: 'recovery-failover',
    category: 'recovery',
    prompt: 'Si el proveedor LLM devuelve 429, ¿qué estrategia aplicas?',
    check: (out) => /failover|otro proveedor|backoff|espera/i.test(out),
    timeoutMs: 15_000,
  },
  {
    id: 'recovery-loop-abort',
    category: 'recovery',
    prompt: 'Llevas 5 reintentos de la misma tool con mismo arg y sale igual. ¿Qué decisión tomas?',
    check: (out) => /abort|parar|cambiar|estrateg|pedir ayuda|humano/i.test(out),
    timeoutMs: 15_000,
  },
];

export async function runBenchmark(adapter: AgentAdapter, opts?: {
  tasks?: BenchmarkTask[];
  onProgress?: (idx: number, total: number, taskId: string) => void;
}): Promise<BenchmarkReport> {
  const tasks = opts?.tasks ?? BENCHMARK_TASKS;
  const startedAt = new Date().toISOString();
  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] as BenchmarkTask;
    opts?.onProgress?.(i + 1, tasks.length, t.id);
    try {
      const r = await adapter.run(t);
      const ok = !r.error && t.check(r.output, { toolCalls: r.toolCalls, durationMs: r.durationMs });
      results.push({
        taskId: t.id, category: t.category, ok,
        durationMs: r.durationMs, error: r.error,
        outputPreview: r.output.slice(0, 200),
      });
    } catch (err) {
      results.push({
        taskId: t.id, category: t.category, ok: false,
        durationMs: 0,
        error: (err as Error).message,
        outputPreview: '',
      });
    }
  }

  const finishedAt = new Date().toISOString();
  return aggregate(results, adapter.name, startedAt, finishedAt);
}

function aggregate(
  results: TaskResult[], agentName: string, startedAt: string, finishedAt: string
): BenchmarkReport {
  const cats: TaskCategory[] = ['parsing', 'reasoning', 'planning', 'memory', 'tool_use', 'recovery'];
  const scoreByCategory = {} as BenchmarkReport['scoreByCategory'];
  for (const c of cats) {
    const subset = results.filter(r => r.category === c);
    const passed = subset.filter(r => r.ok).length;
    scoreByCategory[c] = {
      tasks: subset.length,
      passed,
      score: subset.length ? passed / subset.length : 0,
    };
  }
  const passedTotal = results.filter(r => r.ok).length;
  const globalScore = results.length ? passedTotal / results.length : 0;
  const avgLatencyMs = results.length
    ? Math.round(results.reduce((a, r) => a + r.durationMs, 0) / results.length)
    : 0;

  return {
    agentName, startedAt, finishedAt,
    results, scoreByCategory, globalScore, avgLatencyMs,
  };
}

export function formatReport(r: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark · ${r.agentName}`);
  lines.push(`- inicio: ${r.startedAt}`);
  lines.push(`- fin: ${r.finishedAt}`);
  lines.push(`- score global: **${(r.globalScore * 100).toFixed(1)}%** (${r.results.filter(x => x.ok).length}/${r.results.length})`);
  lines.push(`- latencia media: ${r.avgLatencyMs}ms`);
  lines.push('');
  lines.push('## Por categoría');
  for (const [cat, st] of Object.entries(r.scoreByCategory)) {
    lines.push(`- ${cat}: ${st.passed}/${st.tasks} = ${(st.score * 100).toFixed(0)}%`);
  }
  lines.push('');
  lines.push('## Detalle');
  for (const res of r.results) {
    const mark = res.ok ? '✅' : '❌';
    lines.push(`- ${mark} ${res.taskId} (${res.category}) · ${res.durationMs}ms${res.error ? ' · ' + res.error : ''}`);
  }
  return lines.join('\n');
}

export function compareReports(reports: BenchmarkReport[]): string {
  if (reports.length === 0) return '';
  const lines: string[] = [];
  lines.push('# Tabla comparativa');
  lines.push('');
  const header = ['categoría', ...reports.map(r => r.agentName)];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
  const cats: TaskCategory[] = ['parsing', 'reasoning', 'planning', 'memory', 'tool_use', 'recovery'];
  for (const c of cats) {
    const row = [c, ...reports.map(r => {
      const s = r.scoreByCategory[c];
      return `${(s.score * 100).toFixed(0)}% (${s.passed}/${s.tasks})`;
    })];
    lines.push('| ' + row.join(' | ') + ' |');
  }
  lines.push('| **global** | ' + reports.map(r => `**${(r.globalScore * 100).toFixed(1)}%**`).join(' | ') + ' |');
  lines.push('| latencia | ' + reports.map(r => `${r.avgLatencyMs}ms`).join(' | ') + ' |');
  return lines.join('\n');
}
