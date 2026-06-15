// Kaname (要): el núcleo inmutable + la frontera núcleo/skills — designa el núcleo, enforcea aislamiento/mediación/inmutabilidad y orquesta el enjambre sin que toque el suelo. Aditivo, gated KANAME_ENABLED.
/**
 * kaname — barrel. El remache del abanico: un núcleo mínimo, congelado y verificado,
 * separado por una frontera dura de todo lo que crece y muta. Hace estructural la
 * robustez — el enjambre genera en userspace, Sello certifica en la puerta, y el
 * núcleo permanece intacto pase lo que pase fuera. Aditivo + gated (KANAME_ENABLED).
 */
export * from './config.js';
export * from './types.js';
export { classifyZone, lintBoundary, boundaryClean, CORE_PATHS, CONTRACT_PATHS, USERSPACE_PATHS, type Zone, type ImportEdge, type BoundaryViolation } from './boundary.js';
export { coreHash, writeAllowed, guardCoreWrite, stampVersion, type WriteAttempt } from './immutability.js';
export { loadSkill, type LoadResult } from './contract.js';
export { makeMediator, SyscallDenied, type KernelHost } from './mediator.js';
export { KanameStore, sharedKanameStore, type KanameStoreOptions } from './store.js';
export {
  loadIntoCatalog, unloadSkill, runOracleBattery, admitToUserspace, canPromote,
  promoteKernel, revertKernel,
  type OracleVerdict, type OracleRunner, type BatteryResult, type AdmitResult, type PromotionResult,
} from './evolution.js';
export { assignFronts, integrateWrites, orchestrateSwarm, type WorkerResult, type LaunchClaude, type SwarmRunResult } from './swarm.js';
export {
  defaultExec, makeFsKernelHost, makeClaudeLauncher, parseGitWrites, createWorktree, removeWorktree,
  type Exec, type FsHostOptions, type LauncherOptions,
} from './live.js';
