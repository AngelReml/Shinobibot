// Barrel del harness de benchmark (FASE 1) — runner, tasks, adapters, report y results.
// src/bench/index.ts — API pública del harness de benchmark (FASE 1).
export * from './types.js';
export { runBenchmark, type RunBenchmarkOptions } from './runner.js';
export { summarize, toMarkdown, type BenchReport, type AgentSummary } from './report.js';
export { BENCH_TASKS } from './tasks.js';
export { S_POLICY_TASKS, S_POLICY_VERSION } from './suites/s_policy.js';
export { S_AGENTIC_TASKS, S_AGENTIC_VERSION } from './suites/s_agentic.js';
export { ShinobiAdapter } from './adapters/shinobi_adapter.js';
export { MockAdapter, type MockBehavior } from './adapters/mock_adapter.js';
export { CliAdapter, type CliAdapterConfig } from './adapters/cli_adapter.js';
export { hermesRealAdapter, openClawRealAdapter, competitorRealAdapters, type CompetitorOptions } from './adapters/competitors.js';
export { loadBenchConfig, competitorAdapters, type BenchConfig } from './config.js';
export { writeResults, type WriteResultsOutput } from './results.js';
