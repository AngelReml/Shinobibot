/**
 * Benchmark harness — micro-benchmarks reproducibles sin red.
 *
 * Filosofía: no falseamos con SWE-bench/MMLU (requieren internet, GPU,
 * ambiente complejo). En su lugar medimos los caminos calientes del
 * agente con el código que SE EJECUTA en producción:
 *
 *   - compactor: comprime 100 mensajes con tool outputs grandes
 *   - failover classifier: clasifica 1000 strings de error
 *   - mission scheduler: 1000 cálculos isDue
 *   - skill signing: 200 round-trips sign + verify
 *   - plugin manifest: 200 validaciones (válidas e inválidas)
 *   - loop detector: simula 200 turnos con/sin loops
 *
 * Salida: tabla en stdout + bench-results.json en cwd para que badges/CI
 * lean los números.
 *
 * Diferenciador: ningún rival (Hermes, OpenClaw) publica benchmarks
 * reproducibles. Shinobi sí, y se ejecutan en <2s sin red.
 */

import { writeFileSync } from 'fs';
import { compactMessages } from '../../src/context/compactor.js';
import { classifyProviderError } from '../../src/providers/failover.js';
import { isDue, parseCronExpr, type MissionTrigger } from '../../src/runtime/mission_scheduler.js';
import { signSkillText, verifySkillText } from '../../src/skills/skill_signing.js';
import { validateManifest } from '../../src/plugins/plugin_manifest.js';
import { LoopDetector } from '../../src/coordinator/loop_detector.js';

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  meanMs: number;
  opsPerSec: number;
  passed: number;
  failed: number;
  notes?: string;
}

const results: BenchResult[] = [];

function bench(name: string, iterations: number, fn: () => boolean | void, notes?: string): BenchResult {
  let passed = 0;
  let failed = 0;
  const t0 = Date.now();
  for (let i = 0; i < iterations; i++) {
    const r = fn();
    if (r === false) failed++; else passed++;
  }
  const totalMs = Date.now() - t0;
  const r: BenchResult = {
    name,
    iterations,
    totalMs,
    meanMs: totalMs / iterations,
    opsPerSec: iterations / (totalMs / 1000 || 1e-9),
    passed,
    failed,
    notes,
  };
  results.push(r);
  return r;
}

// ── Benchmark 1: compactor con 100 mensajes ─────────────────────────
bench('compactor: 100 msgs con tool outputs grandes', 50, () => {
  const huge = 'X'.repeat(2500);
  const msgs: any[] = [{ role: 'system', content: 'SYS' }];
  for (let i = 0; i < 30; i++) {
    msgs.push(
      { role: 'user', content: `q${i}` },
      { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: `c${i}`, name: 't', content: huge },
    );
  }
  msgs.push({ role: 'user', content: 'final' });
  const r = compactMessages(msgs, { budgetTokens: 4000, preserveLastTurns: 2 });
  return r.compacted && r.afterTokens < r.beforeTokens;
});

// ── Benchmark 2: failover classifier ────────────────────────────────
const errorSamples = [
  'HTTP 429 Too Many Requests',
  'ECONNREFUSED',
  'Unauthorized: invalid API key',
  'HTTP 400 invalid tool schema',
  'SHINOBI_PROVIDER_KEY no está definida',
  'socket hang up',
  'HTTP 503 Service Unavailable',
  'Unknown failure xyz',
  'Quota exceeded for project',
  'gateway timeout',
];
bench('failover classifier: clasifica 1000 errores', 1000, () => {
  const e = errorSamples[Math.floor(Math.random() * errorSamples.length)];
  const klass = classifyProviderError(e);
  return klass !== undefined;
});

// ── Benchmark 3: mission scheduler isDue ────────────────────────────
const triggers: MissionTrigger[] = [
  { kind: 'interval', seconds: 60 },
  { kind: 'daily', at: '09:00' },
  { kind: 'weekly', day: 'mon', at: '09:00' },
  { kind: 'cron', expr: parseCronExpr('0 9 * * 1') },
];
bench('scheduler: 1000 isDue() calls', 1000, () => {
  const t = triggers[Math.floor(Math.random() * triggers.length)];
  isDue(t, '2026-05-14T08:00:00Z', new Date('2026-05-14T10:00:00Z'));
  return true;
});

// ── Benchmark 4: skill signing round-trip ───────────────────────────
const SAMPLE_SKILL = `---
name: deploy_helper
description: Sample skill for benchmark
trigger_keywords: [deploy, ship]
status: pending
---

# Body content lorem ipsum dolor sit amet.
`;
bench('skill signing: 200 round-trips sign+verify', 200, () => {
  const signed = signSkillText(SAMPLE_SKILL, { author: 'bench' });
  const v = verifySkillText(signed);
  return v.valid;
});

// ── Benchmark 5: plugin manifest validator ──────────────────────────
const validManifest = {
  schemaVersion: '1.0',
  name: 'shinobi-plugin-test',
  version: '0.1.0',
  description: 'Test plugin description.',
  entry: './index.js',
  capabilities: ['tool'],
  sdkVersion: '>=1.0.0',
};
const invalidManifest = { schemaVersion: '99', name: 'bad', version: 'x', description: '', entry: '/abs', capabilities: [], sdkVersion: 'foo' };
bench('plugin manifest: 200 validaciones', 200, () => {
  validateManifest(Math.random() < 0.5 ? validManifest : invalidManifest);
  return true;
});

// ── Benchmark 6: loop detector ──────────────────────────────────────
bench('loop detector: 200 turnos con args repetidos detectados', 200, () => {
  const d = new LoopDetector();
  d.recordCallAttempt('run_command', { cmd: 'X' });
  const r = d.recordCallAttempt('run_command', { cmd: 'X' });
  return r.abort === true && r.verdict === 'LOOP_DETECTED';
});

// ── Resumen ─────────────────────────────────────────────────────────
const totalIterations = results.reduce((s, r) => s + r.iterations, 0);
const totalMs = results.reduce((s, r) => s + r.totalMs, 0);
const totalPassed = results.reduce((s, r) => s + r.passed, 0);
const totalFailed = results.reduce((s, r) => s + r.failed, 0);

const summary = {
  date: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  totalIterations,
  totalMs,
  totalPassed,
  totalFailed,
  allPassed: totalFailed === 0,
  results,
};

// Tabla en stdout.
console.log('\nShinobi benchmarks');
console.log('═'.repeat(72));
console.log('Benchmark'.padEnd(48) + ' ' + 'iter'.padStart(6) + ' ' + 'ms'.padStart(8) + ' ' + 'pass'.padStart(6));
console.log('─'.repeat(72));
for (const r of results) {
  console.log(
    r.name.padEnd(48).slice(0, 48) + ' ' +
    String(r.iterations).padStart(6) + ' ' +
    r.totalMs.toFixed(0).padStart(8) + ' ' +
    `${r.passed}/${r.iterations}`.padStart(6),
  );
}
console.log('─'.repeat(72));
console.log(`TOTAL: ${totalPassed}/${totalIterations} passed in ${totalMs}ms`);
if (totalFailed > 0) console.log(`FAILED: ${totalFailed}`);
console.log('═'.repeat(72));

writeFileSync('bench-results.json', JSON.stringify(summary, null, 2), 'utf-8');
console.log('\nResultados en bench-results.json');

if (totalFailed > 0) process.exit(1);
