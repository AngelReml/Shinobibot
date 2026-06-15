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
export { buildDawnReport, auditNoFabrication } from './synth/report.js';
export { renderMarkdown, FileSink, type ReportSink } from './synth/render.js';
export { listExportedSymbols, buildCodebaseIndex, type SymbolEntry } from './contrast/codebase_index.js';
export { mapFindingToModule, overlapScore, type ContrastJudge } from './contrast/contrast.js';
export { runMission, resumeMission, type PhaseHandlers, type MissionResult } from './mission/mission.js';
