// src/bench/results.ts
//
// Persiste los resultados del benchmark de forma reproducible: report.md (tabla
// comparativa + detalle por celda) y results.json (datos crudos). Es lo que se
// publica para que cualquiera reproduzca los números.

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import type { BenchResult } from './types.js';
import { summarize, toMarkdown, type BenchReport } from './report.js';

export interface WriteResultsOutput {
  dir: string;
  reportPath: string;
  jsonPath: string;
  report: BenchReport;
}

/** Escribe report.md + results.json en `dir`. Devuelve las rutas y el resumen. */
export function writeResults(results: BenchResult[], dir: string, meta: Record<string, unknown> = {}): WriteResultsOutput {
  const outDir = resolve(dir);
  mkdirSync(outDir, { recursive: true });
  const report = summarize(results);

  const detail = results
    .map((r) => `- [${r.pass ? 'PASS' : 'FAIL'}] **${r.agent}** / ${r.task} (${r.category}) — ${r.iterations} iter, ${r.durationMs}ms${r.error ? ` · error: ${r.error}` : ''} — ${r.checkDetail}`)
    .join('\n');
  const md = `${toMarkdown(report)}\n\n## Detalle por celda\n${detail}\n`;

  const reportPath = join(outDir, 'report.md');
  const jsonPath = join(outDir, 'results.json');
  writeFileSync(reportPath, md, 'utf-8');
  writeFileSync(jsonPath, JSON.stringify({ meta, report, results }, null, 2), 'utf-8');
  return { dir: outDir, reportPath, jsonPath, report };
}
