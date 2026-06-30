// scripts/bench_f43.ts — G5/F4.3: Self-Correction Rate medido
//
// Métrica titular: "% de fallos cazados y corregidos solo" — el verificador
// adversarial (E1) detecta un fallo, reinyecta feedback, y el productor lo
// arregla en el siguiente intento sin intervención humana.
//
// Tres métricas exportadas:
//   - detection_rate  = tareas donde el verificador disparó / total en modo verified
//   - correction_rate = tareas donde el retry corrigió / tareas donde disparó
//   - net_gain        = pass@1 verificado − pass@1 no verificado (valor del loop)
//
// Uso:
//   npx tsx scripts/bench_f43.ts [--mock] [--k N] [--suite s_code|s_policy|s_swe]
//   npx tsx scripts/bench_f43.ts --mock        (CI sin LLM — baseline firmado)
//   npx tsx scripts/bench_f43.ts --k 3          (corrida real, k=3)
//
// En modo mock: se simulan dos corridas (sin verified / con verified) con
// distribución de intentos fijada, para validar el pipeline de métricas.
// En modo real: corre con ShinobiAdapter verified=false luego verified=true.

import '../src/tools/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  runBenchmark, summarize,
  S_CODE_TASKS, S_POLICY_TASKS, S_SWE_TASKS,
  MockAdapter,
} from '../src/bench/index.js';
import { ShinobiAdapter } from '../src/bench/adapters/shinobi_adapter.js';
import type { BenchTask, BenchResult, TaskContext, AgentRunResult } from '../src/bench/types.js';

// ── Utilidades ────────────────────────────────────────────────────────────────

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const suiteArg = args.find(a => a.startsWith('--suite='))?.split('=')[1]
    ?? (args.includes('--suite') ? args[args.indexOf('--suite') + 1] : 's_code');
  const kEq = args.find(a => a.startsWith('--k='))?.split('=')[1];
  const kIdx = args.indexOf('--k');
  const kArg = kEq ?? (kIdx >= 0 ? args[kIdx + 1] : '1');
  return { mock: args.includes('--mock'), k: Math.max(1, Number(kArg) || 1), suite: suiteArg ?? 's_code' };
}

function suiteFor(name: string): BenchTask[] {
  if (name === 's_policy') return S_POLICY_TASKS;
  if (name === 's_swe') return S_SWE_TASKS;
  return S_CODE_TASKS;
}

// ── Métricas F4.3 ─────────────────────────────────────────────────────────────

export interface SelfCorrectionMetrics {
  /** Tareas totales en el conjunto. */
  total: number;
  /** Tareas en modo verificado (selfCorrected es boolean). */
  totalVerified: number;
  /** Veces que el verificador disparó (attempts > 1). */
  detections: number;
  /** Veces que el retry corrigió el fallo (selfCorrected === true). */
  corrections: number;
  /** detections / totalVerified — ¿con qué frecuencia detecta algo? */
  detectionRate: number;
  /** corrections / detections — ¿con qué frecuencia lo arregla? */
  correctionRate: number;
  /** pass sin verified vs pass con verified (diferencia). */
  netGain?: number;
}

export function computeSelfCorrectionMetrics(
  results: BenchResult[],
  baselineResults?: BenchResult[],
): SelfCorrectionMetrics {
  const totalVerified = results.filter(r => typeof r.selfCorrected === 'boolean').length;
  const detections = results.filter(r => (r.attempts ?? 1) > 1).length;
  const corrections = results.filter(r => r.selfCorrected === true).length;

  const detectionRate = totalVerified > 0 ? detections / totalVerified : 0;
  const correctionRate = detections > 0 ? corrections / detections : 0;

  let netGain: number | undefined;
  if (baselineResults) {
    const basePass = baselineResults.filter(r => r.pass).length / Math.max(1, baselineResults.length);
    const verifiedPass = results.filter(r => r.pass).length / Math.max(1, results.length);
    netGain = verifiedPass - basePass;
  }

  return {
    total: results.length,
    totalVerified,
    detections,
    corrections,
    detectionRate,
    correctionRate,
    netGain,
  };
}

// ── Mock ──────────────────────────────────────────────────────────────────────
// Simula la distribución esperada:
//   - 70% tareas: pasan al primer intento (attempts=1, selfCorrected=false)
//   - 20% tareas: verificador detecta + corrige (attempts=2, selfCorrected=true)
//   - 10% tareas: verificador detecta + NO corrige (attempts=2, selfCorrected=false)

function makeMockVerifiedAdapter(taskIds: string[]): MockAdapter {
  const CORRECTED = new Set(taskIds.slice(0, Math.floor(taskIds.length * 0.2)));
  const DETECTED_ONLY = new Set(taskIds.slice(Math.floor(taskIds.length * 0.2), Math.floor(taskIds.length * 0.3)));

  return new MockAdapter('shinobi', async (task: BenchTask, ctx: TaskContext): Promise<AgentRunResult> => {
    const corrected = CORRECTED.has(task.id);
    const detectedOnly = DETECTED_ONLY.has(task.id);
    const attempts = (corrected || detectedOnly) ? 2 : 1;
    const selfCorrected = corrected;
    const pass = !detectedOnly; // si solo detectó pero no corrigió, falla
    return {
      finalText: pass ? `mock: ${task.id} completado` : `mock: ${task.id} sin corrección`,
      ok: pass,
      iterations: attempts * 3,
      toolsUsed: ['read_file', 'write_file'],
      durationMs: attempts * 60,
      attempts,
      selfCorrected,
    };
  });
}

function makeMockBaselineAdapter(): MockAdapter {
  // Baseline sin verificación: 70% pasan (los que verificado corrige)
  return new MockAdapter('shinobi-baseline', async (task: BenchTask): Promise<AgentRunResult> => {
    return {
      finalText: `mock baseline: ${task.id}`,
      ok: true,
      iterations: 3,
      toolsUsed: ['read_file'],
      durationMs: 60,
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { mock, k, suite } = parseArgs();
  const tasks = suiteFor(suite);

  console.log(`\n⚔  Shinobi F4.3 — Self-Correction Rate`);
  console.log(`   suite=${suite} · modo=${mock ? 'mock' : 'real'} · k=${k}\n`);

  let baselineResults: BenchResult[];
  let verifiedResults: BenchResult[];

  if (mock) {
    const taskIds = tasks.map(t => t.id);
    // Baseline (sin verificación)
    baselineResults = await runBenchmark(tasks, [makeMockBaselineAdapter()], {
      repeat: k,
      onResult: (r) => process.stdout.write(`  [baseline] ${r.pass ? '✅' : '❌'} ${r.task}\n`),
    });
    // Verified
    verifiedResults = await runBenchmark(tasks, [makeMockVerifiedAdapter(taskIds)], {
      repeat: k,
      onResult: (r) => {
        const tag = r.selfCorrected ? '🔄' : (r.attempts ?? 1) > 1 ? '🔍' : '  ';
        process.stdout.write(`  [verified] ${r.pass ? '✅' : '❌'} ${tag} ${r.task}\n`);
      },
    });
  } else {
    // Modo real: dos corridas con el mismo adaptador en modos distintos
    const baselineAdapter = new ShinobiAdapter({ verified: false });
    const verifiedAdapter = new ShinobiAdapter({ verified: true });

    console.log('  Corrida 1/2: sin verificador (baseline)...');
    baselineResults = await runBenchmark(tasks, [baselineAdapter], {
      repeat: k,
      onResult: (r) => process.stdout.write(`  [baseline] ${r.pass ? '✅' : '❌'} ${r.task}\n`),
    });

    console.log('\n  Corrida 2/2: con verificador (verified=true)...');
    verifiedResults = await runBenchmark(tasks, [verifiedAdapter], {
      repeat: k,
      onResult: (r) => {
        const tag = r.selfCorrected ? '🔄' : (r.attempts ?? 1) > 1 ? '🔍' : '  ';
        process.stdout.write(`  [verified] ${r.pass ? '✅' : '❌'} ${tag} ${r.task}\n`);
      },
    });
  }

  const metrics = computeSelfCorrectionMetrics(verifiedResults, baselineResults);

  // ── Reporte ───────────────────────────────────────────────────────────────

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mode = mock ? 'mock' : 'real';
  const reportPath = path.join('bench_results', `f43_${mode}_${suite}_${ts}.md`);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const report = [
    `# Shinobi F4.3 — Self-Correction Rate`,
    ``,
    `**Fecha:** ${new Date().toISOString()}`,
    `**Suite:** ${suite} · **Modo:** ${mode} · **k:** ${k}`,
    ``,
    `## Métricas principales`,
    ``,
    `| Métrica | Valor | Significado |`,
    `|---|---|---|`,
    `| Tareas totales | ${metrics.total} | — |`,
    `| Detection rate | ${pct(metrics.detectionRate)} | Verifier disparó / total tareas |`,
    `| Correction rate | ${pct(metrics.correctionRate)} | Tareas corregidas / tareas detectadas |`,
    metrics.netGain !== undefined
      ? `| Net gain | ${metrics.netGain >= 0 ? '+' : ''}${pct(metrics.netGain)} | Pass@1 verified − pass@1 baseline |`
      : '',
    ``,
    `## Detalle`,
    ``,
    `| Campo | Valor |`,
    `|---|---|`,
    `| Tareas en modo verified | ${metrics.totalVerified} |`,
    `| Veces que verifier disparó (attempts > 1) | ${metrics.detections} |`,
    `| Veces que retry corrigió (selfCorrected) | ${metrics.corrections} |`,
    `| Baseline pass@1 | ${baselineResults.filter(r => r.pass).length}/${baselineResults.length} (${pct(baselineResults.filter(r => r.pass).length / baselineResults.length)}) |`,
    `| Verified pass@1 | ${verifiedResults.filter(r => r.pass).length}/${verifiedResults.length} (${pct(verifiedResults.filter(r => r.pass).length / verifiedResults.length)}) |`,
    ``,
    `## Leyenda`,
    ``,
    `- 🔄 verificador disparó y corrigió (selfCorrected=true)`,
    `- 🔍 verificador disparó pero no corrigió (attempts>1, selfCorrected=false)`,
    `- ✅ / ❌ resultado final del check`,
    ``,
    `---`,
    `*Generado por shinobi bench_f43.ts · F4.3 Self-Correction Rate*`,
  ].filter(Boolean).join('\n');

  fs.writeFileSync(reportPath, report);
  const sha = sha256File(reportPath);

  console.log(`\n─────────────────────────────────────────`);
  console.log(`  Detection rate  : ${pct(metrics.detectionRate)}  (verifier disparó ${metrics.detections}/${metrics.totalVerified})`);
  console.log(`  Correction rate : ${pct(metrics.correctionRate)}  (corrigió ${metrics.corrections}/${metrics.detections})`);
  if (metrics.netGain !== undefined) {
    console.log(`  Net gain        : ${metrics.netGain >= 0 ? '+' : ''}${pct(metrics.netGain)}  (pass verified − baseline)`);
  }
  console.log(`\n  Reporte         : ${reportPath}`);
  console.log(`  sha256          : ${sha}`);
  console.log(`─────────────────────────────────────────\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
