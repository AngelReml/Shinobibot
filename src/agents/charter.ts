/**
 * agents/charter.ts — E7: CARTA FUNDACIONAL firmada.
 *
 * La carta es el contrato público del agente con el operador y el mundo:
 *   - quién lo opera,
 *   - qué invariantes de seguridad nunca se violarán,
 *   - cuándo fue firmada,
 *   - firmada con Ed25519 (la misma clave que el proveedor de provenance v2).
 *
 * Una vez firmada, la carta es INMUTABLE: re-firmar crea una carta nueva v2,
 * la antigua permanece en el ledger para auditoría. Es la "prueba de existencia"
 * que el PLAN_SOMBRA exige antes de la emergencia pública.
 *
 * Por qué importa: los firmantes Ed25519 de individual task-provenances (E7) y
 * de la carta fundacional son la MISMA clave del operador. Cualquier verificador
 * externo puede comprobar, sin secreto compartido, que las promesas fueron hechas
 * y que las tareas fueron ejecutadas por el mismo agente que las firmó.
 */

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'node:crypto';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface CharterBody {
  charterId: string;
  agentId: string;          // 'shinobi'
  operatorId: string;       // who runs this instance (email, alias, etc.)
  version: string;          // '1.0', '1.1', …
  createdAt: string;        // ISO-8601
  /**
   * Las promesas inmutables del agente. Escribir una promesa aquí es firmarla;
   * violarla invalidaría la firma — lo cual hace la violación comprobable a posteriori.
   */
  coreInvariants: string[];
}

export interface SignedCharter {
  body: CharterBody;
  /** SHA-256 del JSON canónico del body. */
  bodyHash: string;
  /** Clave pública Ed25519 (SPKI PEM) embebida para verificación pública. */
  publicKeyPem: string;
  /** Firma Ed25519 (hex) del bodyHash. */
  signature: string;
}

export interface CharterVerification {
  valid: boolean;
  reason: 'ok' | 'hash_mismatch' | 'signature_mismatch' | 'malformed';
}

// ── Invariantes de referencia ─────────────────────────────────────────────────

/**
 * Conjunto mínimo de invariantes que Shinobi garantiza por diseño.
 * El operador puede añadir los suyos; no puede eliminar los de referencia
 * (el kaname boundary los protege).
 */
export const CORE_INVARIANTS_V1: string[] = [
  'Shinobi nunca ejecutará acciones irreversibles (borrar/enviar/pagar) sin aprobación explícita del operador.',
  'Shinobi nunca modificará su propio núcleo (src/kaname/, src/integrity/) salvo por el proceso de promoción verificado.',
  'Shinobi nunca exfiltrará datos fuera de los canales aprobados (egress opt-in).',
  'Shinobi nunca forjará su rastro de auditoría: el audit es append-only y hash-chained.',
  'Shinobi nunca auto-promoverá una skill que haya fallado su oráculo.',
  'Toda acción de Shinobi queda registrada en el audit.jsonl con prueba firmada verificable por cualquiera.',
];

// ── Core ──────────────────────────────────────────────────────────────────────

/** JSON canónico del body (orden de claves fijo) para hashing y firma deterministas. */
function canonicalBody(body: CharterBody): string {
  return JSON.stringify({
    charterId: body.charterId,
    agentId: body.agentId,
    operatorId: body.operatorId,
    version: body.version,
    createdAt: body.createdAt,
    coreInvariants: body.coreInvariants,
  });
}

/**
 * Firma la carta fundacional con la clave privada Ed25519 del operador.
 * La clave pública se embebe para verificación pública sin secreto compartido.
 */
export function signCharter(body: CharterBody, opts: { privateKeyPem: string; publicKeyPem: string }): SignedCharter {
  const canon = canonicalBody(body);
  const bodyHash = createHash('sha256').update(canon).digest('hex');
  const priv = createPrivateKey(opts.privateKeyPem);
  const signature = edSign(null, Buffer.from(bodyHash), priv).toString('hex');
  return { body, bodyHash, publicKeyPem: opts.publicKeyPem, signature };
}

/**
 * Verifica una carta firmada sin secreto compartido:
 *   1) Recomputa el hash del body canónico → detecta cualquier modificación.
 *   2) Verifica la firma Ed25519 con la pública embebida → auténtica del operador.
 */
export function verifyCharter(charter: SignedCharter): CharterVerification {
  try {
    const expectedHash = createHash('sha256').update(canonicalBody(charter.body)).digest('hex');
    if (expectedHash !== charter.bodyHash) return { valid: false, reason: 'hash_mismatch' };
    const pub = createPublicKey(charter.publicKeyPem);
    const ok = edVerify(null, Buffer.from(charter.bodyHash), pub, Buffer.from(charter.signature, 'hex'));
    return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

/** Genera un par de claves Ed25519 para el operador (alias de provenance_v2). */
export function generateCharterKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Construye el body de la carta con los invariantes de referencia + los del operador. */
export function buildCharterBody(opts: {
  charterId?: string;
  agentId?: string;
  operatorId: string;
  version?: string;
  createdAt?: string;
  extraInvariants?: string[];
}): CharterBody {
  return {
    charterId: opts.charterId ?? `charter_${createHash('sha256').update(opts.operatorId + (opts.createdAt ?? new Date().toISOString())).digest('hex').slice(0, 12)}`,
    agentId: opts.agentId ?? 'shinobi',
    operatorId: opts.operatorId,
    version: opts.version ?? '1.0',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    coreInvariants: [...CORE_INVARIANTS_V1, ...(opts.extraInvariants ?? [])],
  };
}
