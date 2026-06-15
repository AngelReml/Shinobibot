/**
 * shugyo/adapters.ts — S-03: the ⚠ ENGANCHE seams, verified against real signatures.
 * The explorer reuses, never reimplements:
 *   - Chizu       → target selection (selectTarget/chooseVia over the Atlas cards).
 *   - sandbox     → the revertible cage (DirCageSandbox).
 *   - Sello       → certification in the cage (certifyInCage / synthesizeSkill).
 *   - swarm       → parallel exploration (runSwarm).
 *   - Kagami      → publish a certified skill as a measured CapabilityCell (frontier).
 * Thin forwarders + one builder (publishToKagami). No new capability is born here.
 */

import { classifyCapability } from '../kagami/frontier/map.js';
import type { CapabilityCell } from '../kagami/types.js';
import type { LearnedSkill } from './types.js';

// Re-export the real seams (compile against the real modules = the GATE).
export { selectTarget, chooseVia, type Target } from './target.js';
export { DirCageSandbox, type CageExecutor } from './sandbox/revertible.js';
export { synthesizeSkill, certifyInCage, type SkillManifest, type CertResult } from './synth/certify.js';
export { runSwarm } from '../agents/swarm.js';

/**
 * ⚠ ENGANCHE Kagami: publish a certified skill as a measured CapabilityCell, so the
 * mirror's frontier reflects what the explorer actually learned. The verdict comes
 * from the measured success_rate against the certification bank — never presumed.
 */
export function publishToKagami(
  skill: LearnedSkill,
  measured: { success_rate: number; sample_size: number; declared_confidence: number; measured_at: string; source_bank: string },
): CapabilityCell {
  return classifyCapability({
    capability_id: skill.capability_id,
    category: skill.app_id,
    success_rate: measured.success_rate,
    sample_size: measured.sample_size,
    declared_confidence: measured.declared_confidence,
    source_bank: measured.source_bank,
    measured_at: measured.measured_at,
  });
}
