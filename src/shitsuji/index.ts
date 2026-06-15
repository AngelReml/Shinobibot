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
