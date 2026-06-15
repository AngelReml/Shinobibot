/**
 * chizu — barrel. Level-3: the cartographer. Recognizes the terrain before
 * stepping on it. Additive + gated by CHIZU_ENABLED (default off). The map
 * contains only what it verified to exist — it never invents a street.
 */
export * from './config.js';
export * from './types.js';
export { fuse, normalizeExe, type SourceBatch } from './discovery/fuse.js';
export { parseUninstallJson, parseAppxJson, parseWingetList } from './discovery/parsers.js';
export { rot13, decodeUserAssistName, parseUserAssistBlob, filetimeToIso, type UserAssistEntry } from './usage/userassist.js';
export { scoreUsage, rankByUsage } from './usage/score.js';
export { classifyRisk, inferCategory } from './characterize/risk.js';
export { automationCandidateScore } from './characterize/candidate.js';
export { Atlas } from './atlas/atlas.js';
export { ChizuStore, sharedChizuStore, type ChizuStoreOptions } from './store.js';
export { discoverSource, protectedResources, DISCOVERY_COMMANDS, type CmdRunner, type ProtectedResource } from './adapters.js';
export { characterizeStatic, type CharacterizeInput } from './characterize/characterize.js';
export { consolidateAtlas, consolidateAndPersist } from './atlas/consolidate.js';
