// src/bench/index.ts — API pública del harness de benchmark (FASE 1).
export * from './types.js';
export { runBenchmark, type RunBenchmarkOptions } from './runner.js';
export { summarize, toMarkdown, type BenchReport, type AgentSummary } from './report.js';
export { BENCH_TASKS } from './tasks.js';
export { ShinobiAdapter } from './adapters/shinobi_adapter.js';
export { MockAdapter, type MockBehavior } from './adapters/mock_adapter.js';
export { CliAdapter, type CliAdapterConfig } from './adapters/cli_adapter.js';
