// P4 — firma Ed25519 de la policy (para que una policy no se pueda alterar sin ser
// el operador). Misma primitiva que mandate_sign/provenance_v2 (node:crypto): hash
// SHA-256 del canónico → firma → verificación con la pública. La firma va EMBEBIDA en
// el JSON de la policy (campo `signature`), y se computa sobre la policy SIN ese campo.

import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'crypto';
import type { Policy } from './engine.js';

/** Canónico determinista de la policy (sin el campo de firma) para hashear/firmar. */
export function canonicalPolicy(p: Policy): string {
  return JSON.stringify({
    default: [...p.default],
    profiles: p.profiles ?? null,
    ttlMs: p.ttlMs ?? null,
  });
}

export interface PolicySignature {
  readonly signature: string;
  readonly publicKeyPem: string;
}

/** Firma la policy con la privada de la identidad de dispositivo. */
export function signPolicy(p: Policy, privateKeyPem: string, publicKeyPem: string): PolicySignature {
  const hash = createHash('sha256').update(canonicalPolicy(p)).digest('hex');
  return { signature: edSign(null, Buffer.from(hash), createPrivateKey(privateKeyPem)).toString('hex'), publicKeyPem };
}

/** Verifica la firma de una policy con solo la pública. false si no valida o está malformada. */
export function verifyPolicySignature(p: Policy, sig: PolicySignature): boolean {
  try {
    const hash = createHash('sha256').update(canonicalPolicy(p)).digest('hex');
    return edVerify(null, Buffer.from(hash), createPublicKey(sig.publicKeyPem), Buffer.from(sig.signature, 'hex'));
  } catch {
    return false;
  }
}
