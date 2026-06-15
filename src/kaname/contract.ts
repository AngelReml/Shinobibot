/**
 * kaname/contract.ts — KN-02: la frontera de carga. Una skill se presenta con su
 * manifiesto (§6.1, ⚠ Sello §10) + su CSV; el cargador es el PORTERO: sin CSV válido
 * de Sello, la skill se rechaza — no entra a userspace. Reutiliza verifyCsvCertificate
 * (no reimplementa la verificación). Puro: el montaje aislado lo hace el catálogo.
 */

import { verifyCsvCertificate, type SkillCSVLike } from '../integrity/csv_verify.js';
import type { SkillManifestLite, SkillRecord } from './types.js';

export interface LoadResult { record: SkillRecord; admitted: boolean; reason: string }

/**
 * Validate + decide admission. CERTIFIED CSV (valid signature/this_hash) ⇒ 'loaded';
 * missing/invalid CSV ⇒ 'rejected'. The manifest must declare a skill_id matching
 * the CSV subject (binds the certificate to the exact skill).
 */
export function loadSkill(manifest: SkillManifestLite, csv: SkillCSVLike | null, opts: { createdBy: 'swarm' | 'manual'; csvRef?: string } = { createdBy: 'manual' }): LoadResult {
  const base: Omit<SkillRecord, 'status'> = {
    skill_id: manifest.skill_id, csv_ref: opts.csvRef ?? `csv:${manifest.skill_id}`,
    manifest_ref: `manifest:${manifest.skill_id}`, created_by: opts.createdBy, isolation: 'sandboxed',
  };
  if (!csv) return { record: { ...base, status: 'rejected' }, admitted: false, reason: 'sin CSV — no certificada' };
  const v = verifyCsvCertificate(csv);
  if (!v.ok) return { record: { ...base, status: 'rejected' }, admitted: false, reason: `CSV inválido: ${v.reasons.join('; ')}` };
  if (csv.subject?.skill_id && csv.subject.skill_id !== manifest.skill_id) {
    return { record: { ...base, status: 'rejected' }, admitted: false, reason: `el CSV certifica "${csv.subject.skill_id}", no "${manifest.skill_id}"` };
  }
  return { record: { ...base, status: 'loaded' }, admitted: true, reason: 'CSV válido + CERTIFIED' };
}
