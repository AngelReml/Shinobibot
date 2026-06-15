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
