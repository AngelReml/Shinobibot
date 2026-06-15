/**
 * tenshu/export.ts — TS-07: CONSULTAR. Export the verifiable trace as a portable
 * bundle a third party can audit WITHOUT trusting Shinobi, and verify it: chain
 * linkage (genesis→…) + ed25519 signatures (when the entries are signed, FASE D).
 * Pure (the signature check reuses shitsuji/live.verifyTevSignature).
 */

import { verifyTevLinkage } from './tev_browser.js';
import { verifyTevSignature, type SignedTEVEntry } from '../shitsuji/live.js';
import type { TEVEntry } from '../shitsuji/types.js';

export interface AuditBundle {
  plan_id: string;
  exported_at: string;
  entries: TEVEntry[];
  signed: boolean;
}

export function exportForAudit(planId: string, entries: TEVEntry[], exportedAt: string): AuditBundle {
  const signed = entries.length > 0 && entries.every((e) => (e as SignedTEVEntry).signature?.alg === 'ed25519');
  return { plan_id: planId, exported_at: exportedAt, entries, signed };
}

export interface AuditVerdict { ok: boolean; linkage_ok: boolean; signatures_ok: boolean; length: number; detail: string; }

/** Verify a bundle a third party received: chain linkage + (if signed) every signature. */
export function verifyAuditBundle(bundle: AuditBundle): AuditVerdict {
  const linkage = verifyTevLinkage(bundle.entries);
  let signatures_ok = true;
  if (bundle.signed) signatures_ok = bundle.entries.every((e) => verifyTevSignature(e as SignedTEVEntry));
  const ok = linkage.ok && signatures_ok;
  return {
    ok, linkage_ok: linkage.ok, signatures_ok, length: bundle.entries.length,
    detail: ok ? `cadena de ${bundle.entries.length} verificada${bundle.signed ? ' + firmas ed25519' : ' (sin firmar)'}`
      : !linkage.ok ? `eslabón roto en ${linkage.broken_at}` : 'firma ed25519 inválida',
  };
}
