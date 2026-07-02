// P2.E5 (plan de frontera) — Recibo de Misión: la corona del "Modo Cristal".
//
// Al cerrar una misión, Shinobi puede emitir un artefacto FIRMADO que un tercero
// verifica con SOLO la pública del dispositivo, sin acceso a la máquina ni confianza
// en Shinobi, y que prueba tres cosas:
//   1) AUTENTICIDAD  — lo produjo esta instalación (firma Ed25519 sobre el contenido).
//   2) INTEGRIDAD    — el rastro no se tocó (incluye la raíz del hash-chain del audit).
//   3) NO-EXCESO     — NINGÚN efecto permitido de la misión excedió su mandato
//                      (`effectsWithinMandate`). Es la diferencia entre "confía en que
//                      el agente se portó bien" y "compruébalo tú, criptográficamente".
//
// Reutiliza TODO lo ya verificado: la primitiva Ed25519 (node:crypto, igual que
// provenance_v2/mandate_sign), la raíz de cadena del audit (`audit_chain`) y el
// chequeo de cobertura del mandato (`mandate.ts`). No inventa cripto ni una segunda
// noción de mandato. Alcance honesto: prueba integridad+autenticidad+no-exceso; NO
// prueba incorruptibilidad de un proceso ya comprometido antes de firmar (mismo
// modelo de amenaza que provenance_v2 — Certificate-Transparency-like).

import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'crypto';
import { chainRoot, toLines } from '../audit/audit_chain.js';
import { effectsWithinMandate, type Mandate, type ExecutedEffect } from '../sandbox/mandate.js';

export interface MissionReceipt {
  readonly version: 1;
  readonly alg: 'ed25519';
  readonly missionId: string;
  /** Mandato concedido a la misión, o null si corrió en modo legado (sin mandato). */
  readonly mandate: { capabilities: string[]; expiresAt?: number } | null;
  /** Efectos ejecutados (del audit): kind + scope + decisión. */
  readonly effects: ExecutedEffect[];
  /** Modelos LLM realmente usados en la misión. */
  readonly models: string[];
  /** Raíz del hash-chain del tramo de audit de la misión. */
  readonly auditChainRoot: string;
  /** SHA-256 (hex) del canónico (incluye auditChainRoot). */
  readonly contentHash: string;
  /** Firma Ed25519 (hex) del contentHash. */
  readonly signature: string;
  /** Pública Ed25519 (SPKI/PEM) del dispositivo. */
  readonly publicKeyPem: string;
  readonly signedAt: string;
}

interface ReceiptCore {
  missionId: string;
  mandate: { capabilities: string[]; expiresAt?: number } | null;
  effects: ExecutedEffect[];
  models: string[];
  auditChainRoot: string;
}

/** Canónico determinista (orden de claves fijo) sobre el que se hashea y firma. */
function canonical(c: ReceiptCore): string {
  return JSON.stringify({
    missionId: c.missionId,
    mandate: c.mandate ? { capabilities: [...c.mandate.capabilities], expiresAt: c.mandate.expiresAt ?? null } : null,
    effects: c.effects.map((e) => ({ kind: e.kind, scope: e.scope, decision: e.decision })),
    models: [...c.models],
    auditChainRoot: c.auditChainRoot,
  });
}

export interface BuildMissionReceiptInput {
  missionId: string;
  mandate: Mandate | null;
  effects: ExecutedEffect[];
  models?: string[];
  /** Texto JSONL del tramo de audit de la misión (para computar la raíz). */
  auditText?: string;
  privateKeyPem: string;
  publicKeyPem: string;
  now?: () => string;
}

/** Construye el Recibo de Misión firmado. */
export function buildMissionReceipt(input: BuildMissionReceiptInput): MissionReceipt {
  const auditChainRoot = chainRoot(toLines(input.auditText ?? ''));
  const mandate = input.mandate
    ? { capabilities: [...input.mandate.capabilities], expiresAt: input.mandate.expiresAt }
    : null;
  const core: ReceiptCore = { missionId: input.missionId, mandate, effects: input.effects, models: input.models ?? [], auditChainRoot };
  const contentHash = createHash('sha256').update(canonical(core)).digest('hex');
  const signature = edSign(null, Buffer.from(contentHash), createPrivateKey(input.privateKeyPem)).toString('hex');
  return {
    version: 1,
    alg: 'ed25519',
    ...core,
    contentHash,
    signature,
    publicKeyPem: input.publicKeyPem,
    signedAt: input.now ? input.now() : new Date().toISOString(),
  };
}

export type ReceiptVerification = {
  readonly valid: boolean;
  readonly reason: 'ok' | 'hash_mismatch' | 'audit_root_mismatch' | 'signature_mismatch' | 'mandate_exceeded' | 'malformed';
  readonly offendingEffect?: ExecutedEffect;
};

/**
 * Verifica un Recibo de Misión sin secretos compartidos. Si se aporta `auditText`,
 * además recomputa la raíz del hash-chain y exige que coincida (detecta edición del
 * rastro). El chequeo de NO-EXCESO (efecto permitido fuera del mandato) es la corona.
 */
export function verifyMissionReceipt(r: MissionReceipt, auditText?: string): ReceiptVerification {
  try {
    const core: ReceiptCore = { missionId: r.missionId, mandate: r.mandate, effects: r.effects, models: r.models, auditChainRoot: r.auditChainRoot };
    const expected = createHash('sha256').update(canonical(core)).digest('hex');
    if (expected !== r.contentHash) return { valid: false, reason: 'hash_mismatch' };
    if (auditText !== undefined) {
      if (chainRoot(toLines(auditText)) !== r.auditChainRoot) return { valid: false, reason: 'audit_root_mismatch' };
    }
    const okSig = edVerify(null, Buffer.from(r.contentHash), createPublicKey(r.publicKeyPem), Buffer.from(r.signature, 'hex'));
    if (!okSig) return { valid: false, reason: 'signature_mismatch' };
    if (r.mandate) {
      const comp = effectsWithinMandate(r.effects, { capabilities: r.mandate.capabilities, expiresAt: r.mandate.expiresAt });
      if (!comp.ok) return { valid: false, reason: 'mandate_exceeded', offendingEffect: comp.offending };
    }
    return { valid: true, reason: 'ok' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
