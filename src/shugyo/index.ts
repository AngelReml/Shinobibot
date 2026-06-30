// Nivel 4 — Shugyo (修行): el explorador, aprende programas en jaula revertible → skills certificadas por Sello. Aditivo, gated SHUGYO_ENABLED.
/**
 * shugyo — barrel. Level-4: the explorer. Learns to operate programs in a
 * revertible cage and distills certified skills via Sello. Additive + gated by
 * SHUGYO_ENABLED (default off). Docile programs first; ◆ canvas/vision out of v1.
 */
export * from './config.js';
export * from './types.js';
export { classifyReversibility, executionPolicy, mayExecute, type ExecutionPolicy } from './explore/reversibility.js';
export { parseCliHelp, type CliSurface, type CliFlag, type CliSubcommand } from './surface/cli_parser.js';
export { PatternBook, curveIsDescending } from './curve/patternbook.js';
export { DirCageSandbox, runTrial, type RevertibleSandbox, type CageExecutor, type CageOptions } from './sandbox/revertible.js';
export { selectTarget, chooseVia, type Target } from './target.js';
export { explore, orderByValue, type ExploreBudget } from './explore/explorer.js';
export { induceModel } from './model/induce.js';
export { synthesizeSkill, certifyInCage, type SkillManifest, type CertCase, type CertResult } from './synth/certify.js';
export { ShugyoStore, sharedShugyoStore, type ShugyoStoreOptions } from './store.js';
export { publishToKagami } from './adapters.js';
export { extractAffordances, buildUiSurface, uiGraph, type UiaNode, type UiGraph, type UiEdge } from './surface/uia_surface.js';
export { runForgeDemo, type ForgeResult } from './demo.js';
export { forgeSkill, type ForgeOpts, type ForgeOutput } from './forge.js';
