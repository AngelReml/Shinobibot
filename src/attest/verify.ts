// P2 (Modo Cristal) — Verificador standalone de recibos de mandato.
//
// La corona del Pilar 2: un tercero (o el propio operador) toma una LÍNEA del audit
// (`mission_start`) y verifica, con SOLO la pública embebida, que el mandato con que
// arrancó esa misión fue firmado por esta instalación y no se ha alterado — sin
// acceso a la máquina ni confianza en Shinobi. Sin dependencias del runtime: solo la
// primitiva de firma (`mandate_sign.ts`) para que pueda distribuirse suelto.
//
// Alcance honesto: verifica la AUTENTICIDAD e INTEGRIDAD del mandato firmado. NO
// prueba que la misión respetara el mandato (eso lo da cruzar los efectos auditados
// contra el mandato — el Recibo de Misión completo, P2.E5, que se apoyará aquí).

import { verifyMandateSignature } from './mandate_sign.js';
import type { Mandate } from '../sandbox/mandate.js';

/** Subconjunto relevante de un evento `mission_start` del audit. */
export interface MissionStartRecord {
  kind?: string;
  capabilities?: string[];
  expiresAt?: number;
  signature?: string;
  devicePublicKeyPem?: string;
}

export type ReceiptVerification = {
  readonly valid: boolean;
  readonly reason: 'ok' | 'unsigned' | 'signature_mismatch' | 'malformed';
};

/**
 * Verifica el mandato firmado de un evento `mission_start`. `unsigned` si el evento
 * no trae firma/pública (la firma es best-effort en E3.c). `signature_mismatch` si la
 * firma no valida el mandato con esa pública. `ok` si todo cuadra.
 */
export function verifyMissionStart(rec: MissionStartRecord): ReceiptVerification {
  if (!rec || typeof rec !== 'object') return { valid: false, reason: 'malformed' };
  if (!rec.signature || !rec.devicePublicKeyPem) return { valid: false, reason: 'unsigned' };
  const mandate: Mandate = { capabilities: rec.capabilities ?? [], expiresAt: rec.expiresAt };
  const ok = verifyMandateSignature(mandate, rec.signature, rec.devicePublicKeyPem);
  return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
}

/** Verifica una línea JSONL del audit; devuelve `malformed` si no parsea. */
export function verifyMissionStartLine(jsonl: string): ReceiptVerification {
  try {
    return verifyMissionStart(JSON.parse(jsonl));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
