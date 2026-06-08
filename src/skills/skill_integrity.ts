// src/skills/skill_integrity.ts
//
// FASE 2.C — integridad de skills DESCARGADAS (cierra el gap con OpenClaw).
//
// shinobi ya FIRMA y verifica sus propias skills (skill_signing.ts). Lo que
// faltaba, y donde OpenClaw ganaba, es verificar la integridad de una skill que
// se trae de fuera contra un hash SHA-256 ATESTADO, ANTES de instalarla/cargarla,
// fallando CERRADO si falta la metadata de integridad o no coincide
// (equivalente a MISSING_ARCHIVE_INTEGRITY / ARCHIVE_INTEGRITY_MISMATCH de
// ClawHub). Combinado con la firma propia, da provenance para skills propias Y
// de terceros.

import { createHash } from 'crypto';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export type IntegrityReason = 'match' | 'mismatch' | 'missing_expected';

export interface IntegrityResult {
  ok: boolean;
  reason: IntegrityReason;
  actual: string;
  expected?: string;
}

export interface IntegrityOptions {
  /**
   * Si true (default), una skill SIN hash esperado se RECHAZA (fail-closed):
   * no se confía en lo que no se puede atestar. Pon false solo para fuentes ya
   * confiables (p. ej. builtin local).
   */
  failClosed?: boolean;
}

/**
 * Verifica la integridad de una skill descargada. Devuelve ok=true solo si el
 * hash esperado existe y coincide con el calculado. Fail-closed por defecto.
 */
export function verifyDownloadedSkill(
  skillText: string,
  expectedSha256?: string,
  opts: IntegrityOptions = {},
): IntegrityResult {
  const failClosed = opts.failClosed ?? true;
  const actual = sha256Hex(skillText ?? '');

  if (!expectedSha256 || typeof expectedSha256 !== 'string') {
    // Sin metadata de integridad: rechaza (fail-closed) salvo opt-out explícito.
    return { ok: !failClosed, reason: 'missing_expected', actual };
  }
  const ok = expectedSha256.trim().toLowerCase() === actual.toLowerCase();
  return { ok, reason: ok ? 'match' : 'mismatch', actual, expected: expectedSha256.trim().toLowerCase() };
}

/**
 * Gate para un instalador de skills externas: lanza si la integridad no pasa.
 * Pensado para llamarse JUSTO antes de escribir/registrar la skill descargada.
 */
export function assertDownloadedSkillIntegrity(
  skillText: string,
  expectedSha256?: string,
  opts: IntegrityOptions = {},
): void {
  const r = verifyDownloadedSkill(skillText, expectedSha256, opts);
  if (!r.ok) {
    const msg = r.reason === 'missing_expected'
      ? 'skill descargada sin hash de integridad atestado (rechazada, fail-closed)'
      : `integridad de skill descargada NO coincide: esperado ${r.expected}, calculado ${r.actual}`;
    throw new Error(msg);
  }
}
