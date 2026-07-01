// Nivel 1 — Kagemusha (影武者): el clon-sombra que investiga de noche → Informe del Amanecer, bajo Capa 2. Aditivo, gated KAGEMUSHA_ENABLED.
/**
 * kagemusha — barrel. Level-1: the shadow-double that researches at night.
 * Everything additive + gated by KAGEMUSHA_ENABLED (default off).
 */
export * from './config.js';
export * from './types.js';
export { KagemushaStore, sharedKagemushaStore } from './store/store.js';
export * as adapters from './adapters.js';
export { parseSubtitles, estimateTokens } from './ingest/srt_parser.js';
export { downloadChannelTranscripts, importToCorpus, listSubtitleFiles, transcriptId } from './ingest/transcripts.js';
export { chunkText } from './analysis/chunker.js';
export {
  topicAnalyzer, recurrenceAnalyzer, temporalAnalyzer, contradictionAnalyzer, entityAnalyzer,
  ALL_ANALYZERS, runAnalyzers, resetAnalyzerSeq, type Analyzer,
} from './analysis/analyzers.js';
export { extractEntities, seedFrontier, orchestrateAnalysis, resetEntitySeq, type OrchestrateResult } from './analysis/orchestrate.js';
export { aggregateCredibility, admissibleAsFact, tierForSource } from './thread/credibility.js';
export { Frontier, shouldExpand, canonical, adjustPriorScore } from './thread/frontier.js';
export { extractReferences, resolveReference, tierForUrl } from './thread/resolve.js';
export { acquireNode, type Fetcher, type FetchResult, type AcquireResult } from './thread/acquire.js';
export { analyzeNode, resetClaimSeq, type NodeAnalysis } from './thread/node_analyze.js';
export { persistGraph, loadGraph, resumeMissionGraph, type PersistedGraph, type ResumedMission } from './thread/graph_persist.js';
export { runDawnDemo, type TranscriptFetcher, type DawnDemoResult } from './demo.js';
export { buildDawnReport, auditNoFabrication } from './synth/report.js';
export { renderMarkdown, FileSink, type ReportSink } from './synth/render.js';
export { listExportedSymbols, buildCodebaseIndex, type SymbolEntry } from './contrast/codebase_index.js';
export { mapFindingToModule, overlapScore, type ContrastJudge } from './contrast/contrast.js';
export { runMission, resumeMission, type PhaseHandlers, type MissionResult } from './mission/mission.js';
export {
  runKagemusha, KagemushaDisabledError, runKagemushaToolDescriptor,
  type RunKagemushaOptions, type RunKagemushaToolShape,
} from './trigger.js';
