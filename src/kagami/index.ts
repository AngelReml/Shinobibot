/**
 * kagami — barrel. Level-2: the mirror. Shinobi knows, guards and improves itself
 * with honesty. Additive + gated by KAGAMI_ENABLED (default off). The mirror
 * neither flatters nor diminishes: it reflects.
 */
export * from './config.js';
export * from './types.js';
export { calibrate, biasLabel, evaluate, type Prediction } from './calibration/calibrate.js';
export { classifyCapability, FrontierMap } from './frontier/map.js';
export { recordExam, masteryDemonstrated, type MasteryThreshold } from './learn/mastery.js';
export { secretCrack, detectRegressions, untestedModuleCrack, invariantCracks, vulnerableDepCrack, resetCrackSeq, type Invariant } from './guard/cracks.js';
