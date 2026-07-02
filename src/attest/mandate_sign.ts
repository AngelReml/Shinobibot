// P1.E3.c — Firma Ed25519 del mandato de capacidades.
//
// El plan de frontera pide que el mandato de cada misión quede FIRMADO por la
// identidad de dispositivo, de modo que el evento `mission.start` del audit sea
// verificable por un tercero SIN confiar en Shinobi (la base del "Modo Cristal"/P2).
// Reutiliza la misma primitiva Ed25519 que `provenance_v2.ts` (node:crypto directo:
// hash SHA-256 del canónico → firma sobre el hash → verificación con la pública),
// no una segunda cripto. Firmar prueba AUTENTICIDAD e INTEGRIDAD; no prueba
// incorruptibilidad de un proceso ya comprometido (mismo modelo de amenaza que
// provenance_v2 — dicho sin adornos).

import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'crypto';
import type { Mandate } from '../sandbox/mandate.js';

/** Canónico determinista del mandato (orden de claves fijo) para hashear/firmar. */
export function canonicalMandate(m: Mandate): string {
  return JSON.stringify({ capabilities: [...m.capabilities], expiresAt: m.expiresAt ?? null });
}

export interface MandateSignature {
  /** SHA-256 (hex) del canónico del mandato. */
  readonly contentHash: string;
  /** Firma Ed25519 (hex) del contentHash. */
  readonly signature: string;
  /** Pública Ed25519 (SPKI/PEM) del firmante — el verificador no necesita nada más. */
  readonly publicKeyPem: string;
}

/** Firma el mandato con la privada de la identidad de dispositivo. */
export function signMandate(m: Mandate, privateKeyPem: string, publicKeyPem: string): MandateSignature {
  const contentHash = createHash('sha256').update(canonicalMandate(m)).digest('hex');
  const signature = edSign(null, Buffer.from(contentHash), createPrivateKey(privateKeyPem)).toString('hex');
  return { contentHash, signature, publicKeyPem };
}

export type MandateVerification = {
  readonly valid: boolean;
  readonly reason: 'ok' | 'hash_mismatch' | 'signature_mismatch' | 'malformed';
};

/**
 * Verifica un mandato firmado SIN secretos compartidos:
 *   1) recomputa el hash del canónico → detecta manipulación del mandato,
 *   2) verifica la firma Ed25519 sobre ese hash con la pública embebida.
 * Una pública distinta NO valida una firma que no hizo su privada: falsificar es
 * inviable. `valid` solo si ambos cuadran.
 */
/**
 * Verifica una firma sobre un mandato cuando NO se tiene el objeto `MandateSignature`
 * completo (p.ej. desde un evento `mission_start` del audit, que guarda solo la firma
 * y la pública): recomputa el hash canónico del mandato y verifica la firma sobre él.
 */
export function verifyMandateSignature(m: Mandate, signatureHex: string, publicKeyPem: string): boolean {
  try {
    const contentHash = createHash('sha256').update(canonicalMandate(m)).digest('hex');
    return edVerify(null, Buffer.from(contentHash), createPublicKey(publicKeyPem), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export function verifyMandate(m: Mandate, sig: MandateSignature): MandateVerification {
  try {
    const expected = createHash('sha256').update(canonicalMandate(m)).digest('hex');
    if (expected !== sig.contentHash) return { valid: false, reason: 'hash_mismatch' };
    const ok = edVerify(null, Buffer.from(sig.contentHash), createPublicKey(sig.publicKeyPem), Buffer.from(sig.signature, 'hex'));
    return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
