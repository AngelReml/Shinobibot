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
export { buildSnapshot, healthTrend, crackBurden, type SweepInputs } from './guard/guard.js';
export { buildSelfVoice, attachSelfVoice, type SelfVoiceInputs } from './voice.js';
export { KagamiStore, sharedKagamiStore, type KagamiStoreOptions } from './store.js';
export {
  parseVitestSummary, parseTscErrors, parseLintWarnings, runSuite, runTypecheck, runLint,
  lspErrorCount, selloGradeExam, type CmdRunner, type SuiteResult,
} from './adapters.js';
export {
  loadBank, runBank, measureFromBank, exactGrader, substringGrader,
  type OracleBank, type BankCase, type Grader, type Solver, type BankRun,
} from './bank.js';
