/**
 * kaname/immutability.ts — KN-04: el núcleo es read-only frente a runtime/skills/
 * enjambre, versionado y con hash. "Inmutable" = no cambia por los canales normales
 * (§9). Aquí: hash determinista del conjunto de núcleo + un guard que rechaza toda
 * escritura a rutas de núcleo que no venga del proceso de promoción.
 */

import * as crypto from 'node:crypto';
import { classifyZone } from './boundary.js';
import type { KernelVersion } from './types.js';

/** Content-addressed hash of the core file set (sorted path:contentHash list). */
export function coreHash(files: { path: string; content: string }[]): string {
  const lines = files
    .map((f) => `${f.path}:${crypto.createHash('sha256').update(f.content).digest('hex').slice(0, 16)}`)
    .sort();
  return `sha256:${crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32)}`;
}

export interface WriteAttempt { path: string; origin: 'runtime' | 'skill' | 'swarm' | 'promotion' }

/** Is this write allowed? Writes to core paths are allowed ONLY from the promotion
 *  process; runtime/skill/swarm writing to core is the §13 P1 violation. */
export function writeAllowed(attempt: WriteAttempt): boolean {
  if (classifyZone(attempt.path) !== 'core') return true;     // userspace/external: free
  return attempt.origin === 'promotion';                       // core: only via promotion
}

/** Guard a write; throws if a non-promotion channel targets the core (enforces P1). */
export function guardCoreWrite(attempt: WriteAttempt): void {
  if (!writeAllowed(attempt)) {
    throw new Error(`kaname: BLOQUEADO — ${attempt.origin} intentó escribir en el núcleo (${attempt.path}); el núcleo solo cambia por promoción (§9)`);
  }
}

/** Build a KernelVersion stamp from the core hash + the oracle state. */
export function stampVersion(version: string, files: { path: string; content: string }[], opts: { promotedAt: string; dojoHardTests: 'green' | 'red'; suite: { passed: number; skipped: number } }): KernelVersion {
  return { version, hash: coreHash(files), promoted_at: opts.promotedAt, dojo_hard_tests: opts.dojoHardTests, suite: opts.suite };
}
