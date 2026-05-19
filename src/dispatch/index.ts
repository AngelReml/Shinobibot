// src/dispatch/index.ts
//
// Barrel del clasificador de despacho por afinidad (Bloque 3). Shadow mode:
// clasifica y registra, NUNCA controla el despacho real.

export {
  classifyDispatch,
  classifierPrompt,
} from './classifier.js';
export {
  shadowDispatchEnabled,
  shadowClassifyAndRecord,
  recordShadowDecision,
  readShadowLog,
  summarizeShadowLog,
  shadowLogPath,
} from './shadow_recorder.js';
export {
  SPECIALISTS,
  type DispatchSpecialist,
  type DispatchConfidence,
  type DispatchDecision,
  type ShadowEntry,
} from './types.js';
export { IntentRouter, type IntentRouteResult, type IntentRule } from './intent_router.js';
