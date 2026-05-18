// src/refiner/index.ts
//
// Barrel del refinador de prompts en camino caliente (FASE 1). Shadow mode:
// decide nivel y refina, registra qué haría, NUNCA controla el despacho real.

export {
  classifyLevel,
  levelClassifierPrompt,
  type PromptLevel,
  type LevelConfidence,
  type LevelDecision,
} from './level_classifier.js';
export {
  refineTask,
  HOT_MODEL,
  ESCALATION_MODEL,
  type RefineResult,
} from './hot_refiner.js';
export {
  refinerShadowEnabled,
  refineShadowForTask,
  recordRefinerDecision,
  readRefinerShadowLog,
  summarizeRefinerShadow,
  refinerShadowLogPath,
  type RefinerShadowEntry,
  type RefinerShadowSummary,
} from './refiner_shadow.js';
