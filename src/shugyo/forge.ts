/**
 * shugyo/forge.ts — E6: el puente Shugyo→Sello.
 *
 * El bucle de Kangeiko separa FABRICA (Shugyo) de CERTIFICA (Sello) en dos
 * pasos del Domain. Esta función los fusiona en un pipeline atómico:
 *
 *   Capability + oracle cases + cage
 *     → synthesizeSkill (manifest + hash)
 *     → certifyInCage   (prueba en jaula revertible)
 *     → LearnedSkill    ('certified' | 'discarded') + opcionalmente persiste
 *
 * El caller sigue siendo dueño del ciclo de vida de la jaula (cage.dispose()
 * cuando convenga). forgeSkill no llama dispose() — solo revierte.
 */

import { synthesizeSkill, certifyInCage, type CertCase, type SkillManifest, type CertResult } from './synth/certify.js';
import { DirCageSandbox } from './sandbox/revertible.js';
import type { ShugyoStore } from './store.js';
import type { Capability, LearnedSkill, Via, Grade } from './types.js';

export interface ForgeOpts {
  app_id: string;
  via: Via;
  command: string;
  declared_tools: string[];
  declared_effects: SkillManifest['declared_effects'];
  grade?: Grade;
  /** Si se pasa, persiste la skill (certified o discarded) en la store. */
  store?: ShugyoStore;
}

export interface ForgeOutput {
  skill: LearnedSkill;
  manifest: SkillManifest;
  certResult: CertResult;
}

/**
 * Shugyo→Sello: sintetiza una Capability aprendida en la exploración y la
 * certifica contra el banco de oráculos en la jaula revertible.
 *
 * Invariante: la jaula queda siempre en estado limpio (certifyInCage usa
 * try/finally para garantizarlo). El caller es libre de reutilizar la jaula
 * después de forgeSkill o de descartarla con cage.dispose().
 */
export async function forgeSkill(
  cap: Capability,
  oracleCases: CertCase[],
  cage: DirCageSandbox,
  opts: ForgeOpts,
): Promise<ForgeOutput> {
  if (oracleCases.length === 0) {
    throw new Error(`forgeSkill: no hay casos oracle para "${cap.capability_id}" — sin prueba no hay certificación`);
  }

  const { skill, manifest } = synthesizeSkill(cap, {
    app_id: opts.app_id,
    via: opts.via,
    command: opts.command,
    declared_tools: opts.declared_tools,
    declared_effects: opts.declared_effects,
  });

  const certResult = await certifyInCage(manifest, oracleCases, cage, {
    grade: opts.grade ?? skill.grade,
  });

  const finalSkill: LearnedSkill = {
    ...skill,
    status: certResult.status === 'certified' ? 'certified' : 'discarded',
  };

  opts.store?.upsertSkill(finalSkill);

  return { skill: finalSkill, manifest, certResult };
}
