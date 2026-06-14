/**
 * keys.ts — ed25519 signing for PoBI verdicts (Node built-in crypto, zero deps).
 *
 * PROVENANCE: ported verbatim (logic unchanged) from
 *   OpenGravity/attestation-layer/src/crypto/keys.mjs
 * Adapted: .mjs → .ts types + a loadOrCreateKeypair helper. The verifier signs
 * verdicts with its private key; anyone holding the public key can verify — no
 * trust in our infrastructure required.
 *
 * SECURITY: the keypair is generated NEW for Sello (CONTRACT §2 "clave NUEVA").
 * Private key never leaves the gitignored keys/ dir.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Keypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function saveKeypair(dir: string): Keypair {
  fs.mkdirSync(dir, { recursive: true });
  const kp = generateKeypair();
  fs.writeFileSync(path.join(dir, 'verifier_private.pem'), kp.privateKeyPem);
  fs.writeFileSync(path.join(dir, 'verifier_public.pem'), kp.publicKeyPem);
  return kp;
}

/** Load the verifier keypair from dir, creating a NEW one on first use. */
export function loadOrCreateKeypair(dir: string): Keypair {
  const priv = path.join(dir, 'verifier_private.pem');
  const pub = path.join(dir, 'verifier_public.pem');
  if (fs.existsSync(priv) && fs.existsSync(pub)) {
    return {
      privateKeyPem: fs.readFileSync(priv, 'utf-8'),
      publicKeyPem: fs.readFileSync(pub, 'utf-8'),
    };
  }
  return saveKeypair(dir);
}

/** Sign UTF-8 string/Buffer with an ed25519 PKCS8 PEM private key. Returns hex. */
export function sign(message: Buffer | string, privateKeyPem: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const data = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf-8');
  return crypto.sign(null, data, key).toString('hex');
}

/** Verify an ed25519 signature (hex) against a message and SPKI PEM public key. */
export function verify(message: Buffer | string, signatureHex: string, publicKeyPem: string): boolean {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    const data = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf-8');
    return crypto.verify(null, data, key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/** Short fingerprint of a public key, used as verifier identity. */
export function keyFingerprint(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}
