// Kaname (要): el núcleo inmutable + la frontera núcleo/skills — designa el núcleo, enforcea mediación/inmutabilidad y orquesta el enjambre sin que toque el suelo. Aditivo, gated KANAME_ENABLED.
/**
 * kaname — barrel. El remache del abanico: un núcleo mínimo, congelado y verificado,
 * separado por una frontera dura de todo lo que crece y muta. Hace estructural la
 * robustez — el enjambre genera en userspace, Sello certifica en la puerta, y el
 * núcleo permanece intacto pase lo que pase fuera. Aditivo + gated (KANAME_ENABLED).
 *
 * HONESTIDAD (F2.13, auditoría 2026-07): "frontera"/"mediación"/"aislamiento" aquí
 * son ENFORCEMENT DISCIPLINADO DENTRO DEL MISMO PROCESO NODE — comprobaciones de
 * import (boundary.ts), hash + bloqueo de escritura (immutability.ts), y un
 * mediador de syscalls que es una capa de funciones TypeScript (mediator.ts), NO
 * un sandbox de sistema operativo o de proceso (sin namespaces, sin container, sin
 * VM, sin chroot, sin seccomp). Todo el código de kaname corre con los mismos
 * privilegios de OS que el proceso Shinobi principal. La protección real es: (1)
 * el enjambre de skills se ejecuta como subprocesos separados (swarm.ts,
 * live.ts) con su propio workspace de ficheros, y (2) todo el subsistema está
 * gated por KANAME_ENABLED (default OFF) — sin activarlo explícitamente, ninguna
 * de estas comprobaciones se interpone en el flujo normal.
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
