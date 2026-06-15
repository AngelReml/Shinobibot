/**
 * shitsuji — barrel. Level-5, the butler: composes CERTIFIED skills over the real
 * world. Additive + gated by SHITSUJI_ENABLED (default off). No improvisa, comprueba
 * antes de actuar, no fabrica éxito, deja rastro. The dojo's peak.
 */
export * from './config.js';
export * from './types.js';
export { buildPlan, renderPlan, type StepSpec } from './plan.js';
export { checkFeasibility, type FeasibilityResult } from './feasibility.js';
export { approvalsNeeded, unapproved } from './approval.js';
export { runPlan, assertNoFabrication, type ExecuteDeps } from './execute.js';
export { makeRealExecutor, type SkillInvoker, type SkillInvocation, type RealExecDeps, type RealExecutor } from './runtime.js';
export { understand, comprehend, intentReady, pendingQuestions, applyAnswer, type RefPhrase, type NLParse, type IntentParser, type ReferenceResolvers, type FileCandidate } from './understand.js';
export { ShitsujiStore, sharedShitsujiStore, type ShitsujiStoreOptions, type TevChainVerdict } from './store.js';
export { certifiedRepertoire, atlasFromCards, requestStepApproval, planNeedsApproval } from './adapters.js';
export { serve, type ServeDeps, type ServeResult, type ServeOutcome } from './orchestrate.js';
export {
  llmIntentParser, extractJson, makeSandboxInvoke, fsCopyInputs, makeFsCommit,
  ed25519Keypair, loadOrCreateTevKeypair, signTevEntry, signTevChain, verifyTevSignature,
  type LlmParserOptions, type SandboxInvokeOptions, type SignedTEVEntry, type Ed25519Keypair,
} from './live.js';
