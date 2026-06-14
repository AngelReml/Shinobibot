/**
 * integrity/effects.ts — declared-effects model for runtime check 11.2.
 *
 * A verified skill declares the effects/tools it may produce (CONTRACT §10).
 * This is where that declaration STOPS being metadata and gains enforcement: the
 * concrete action about to run is classified and must fall within what the skill
 * declared. Unknown tools are classified fail-closed (treated as 'write') so an
 * undeclared capability cannot slip past a read_only skill.
 */

export type Effect = 'none' | 'read_only' | 'write' | 'irreversible';

const RANK: Record<Effect, number> = { none: 0, read_only: 1, write: 2, irreversible: 3 };

/**
 * Map a Shinobi tool name → the effect it produces. Mirrors the read-only/
 * destructive split used by src/security/approval.ts, expressed as effects.
 */
const TOOL_EFFECT: Record<string, Effect> = {
  // read-only
  read_file: 'read_only', list_dir: 'read_only', search_files: 'read_only',
  web_search: 'read_only', grep: 'read_only', glob: 'read_only',
  // write
  write_file: 'write', edit_file: 'write', create_file: 'write',
  // irreversible / arbitrary
  run_command: 'irreversible', delete_file: 'irreversible', start_cloud_mission: 'irreversible',
};

/** Classify a tool's effect. Unknown → 'write' (fail-closed). */
export function classifyEffect(toolName: string): Effect {
  return TOOL_EFFECT[toolName] ?? 'write';
}

export function effectRank(e: Effect): number {
  return RANK[e] ?? RANK.write;
}

/** actual ⊆ declared: the action's effect rank must not exceed the declared one. */
export function effectWithin(actual: Effect, declared: Effect): boolean {
  return effectRank(actual) <= effectRank(declared);
}
