/**
 * kangeiko — barrel. The verified self-improvement engine. Additive + gated by
 * KANGEIKO_ENABLED (default off). A certified curve that rises — proven, not claimed.
 */
export * from './config.js';
export * from './types.js';
export { runKangeiko, type KangeikoResult, type Persist } from './loop.js';
export { curveRising, curveDelta, passRate } from './curve.js';
export { closedDojoArena, tagTask, type WebTask } from './domains/web/arena.js';
export { guardExternal, makeCdpWebRunner, makeHttpWebRunner, resolveDojoUrl, type WebRunner, type WebRunOutcome } from './domains/web/runner.js';
export { serveDojo, type DojoServer } from './domains/web/server.js';
export { makeWebDomain, type WebDomain } from './domains/web/domain.js';
export { consolidateRepertoire, isDump, type RepertoireEntry, type ConsolidationResult } from './consolidate.js';
export { KangeikoStore, sharedKangeikoStore, type KangeikoStoreOptions } from './store.js';
