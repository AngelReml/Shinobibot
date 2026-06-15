/**
 * kaname — KN-05 (catálogo), KN-07 (ancla de oráculo en la integración), KN-08
 * (auto-vigilancia anclada + no-auto-promoción) y KN-09 (evolución versionada +
 * reversión). El árbitro final es SIEMPRE un oráculo (no un Claude, no el propio
 * núcleo); lo que no pasa el oráculo no entra ni se promociona.
 */

import { loadSkill, type LoadResult } from './contract.js';
import type { KanameStore } from './store.js';
import type { SkillManifestLite, SkillRecord, KernelVersion } from './types.js';
import type { SkillCSVLike } from '../integrity/csv_verify.js';

// ── KN-05: catálogo (carga/descarga aislada) ────────────────────────────────────

/** Load a skill through the contract and register it in the userspace catalog. */
export function loadIntoCatalog(store: KanameStore, manifest: SkillManifestLite, csv: SkillCSVLike | null, opts: { createdBy: 'swarm' | 'manual' } = { createdBy: 'manual' }): LoadResult {
  const res = loadSkill(manifest, csv, opts);
  store.upsertSkill(res.record);
  return res;
}

/** Unload (isolate) a skill — never touches the core; other skills unaffected. */
export function unloadSkill(store: KanameStore, skillId: string): boolean {
  const r = store.getSkill(skillId);
  if (!r) return false;
  store.upsertSkill({ ...r, status: 'isolated' });
  return true;
}

// ── KN-07/KN-08: el ancla de oráculo ─────────────────────────────────────────────

export type OracleVerdict = { name: string; pass: boolean; raw: string };
/** ⚑ live: run an oracle (suite/tsc/hard test/secrets/regression). Injected. */
export type OracleRunner = () => Promise<OracleVerdict>;

export interface BatteryResult { verdicts: OracleVerdict[]; green: boolean }

/** Run the oracle battery; green iff every oracle passes (§8 — mide, no opina). */
export async function runOracleBattery(runners: OracleRunner[]): Promise<BatteryResult> {
  const verdicts: OracleVerdict[] = [];
  for (const run of runners) {
    try { verdicts.push(await run()); }
    catch (e: any) { verdicts.push({ name: 'oracle', pass: false, raw: `error: ${e?.message ?? e}` }); }
  }
  return { verdicts, green: verdicts.length > 0 && verdicts.every((v) => v.pass) };
}

export interface AdmitResult { admitted: boolean; reason: string; record: SkillRecord }

/**
 * KN-07 — admit to userspace ONLY if the contract admits it (valid CSV) AND the
 * oracle passes. A skill a builder reports "ready" but that fails the oracle does
 * NOT enter (P5), no matter how many workers vouch for it.
 */
export async function admitToUserspace(store: KanameStore, manifest: SkillManifestLite, csv: SkillCSVLike | null, oracle: OracleRunner, opts: { createdBy: 'swarm' | 'manual' } = { createdBy: 'swarm' }): Promise<AdmitResult> {
  const load = loadSkill(manifest, csv, opts);
  if (!load.admitted) { store.upsertSkill(load.record); return { admitted: false, reason: load.reason, record: load.record }; }
  const v = await oracle();
  if (!v.pass) {
    const rejected: SkillRecord = { ...load.record, status: 'rejected' };
    store.upsertSkill(rejected);
    return { admitted: false, reason: `oráculo rojo: ${v.name} — no entra aunque el constructor la reporte lista`, record: rejected };
  }
  store.upsertSkill(load.record);
  return { admitted: true, reason: 'CSV válido + oráculo verde', record: load.record };
}

// ── KN-08: regla de no-auto-promoción ────────────────────────────────────────────

/** A core change is NOT promotable on self-judgement: any red oracle blocks it (P6). */
export function canPromote(battery: BatteryResult): boolean { return battery.green; }

// ── KN-09: evolución versionada + reversión ──────────────────────────────────────

export interface PromotionResult { promoted: boolean; reason: string; version?: KernelVersion }

/**
 * Promote a core version ONLY if its oracle battery is green AND the dojo hard tests
 * are green (§9). Never by silent accumulation. A change that breaks any oracle is
 * blocked (P7).
 */
export function promoteKernel(store: KanameStore, candidate: KernelVersion, battery: BatteryResult): PromotionResult {
  if (!canPromote(battery)) return { promoted: false, reason: `bloqueado: oráculo rojo (${battery.verdicts.filter((v) => !v.pass).map((v) => v.name).join(', ')})` };
  if (candidate.dojo_hard_tests !== 'green') return { promoted: false, reason: 'bloqueado: pruebas duras del dojo en rojo' };
  store.saveVersion(candidate);
  return { promoted: true, reason: 'promocionado: suite + pruebas duras en verde', version: candidate };
}

/** Revert to a known-green previous version (§9 reversible). */
export function revertKernel(store: KanameStore, toVersion: string): KernelVersion | null {
  const target = store.listVersions().find((v) => v.version === toVersion) ?? null;
  if (!target) return null;
  // Re-stamp it as the head by re-saving with a fresh promoted_at marker is the
  // caller's job; here we just return the version to roll back to (state restorer).
  return target;
}
