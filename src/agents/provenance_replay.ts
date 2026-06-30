// src/agents/provenance_replay.ts
//
// F4.1 — REPLAY CON DIVERGENCIA: dado un paquete SignedProvenance firmado y un
// audit candidato (posiblemente adulterado), localiza exactamente en qué línea N
// la cadena de hashes rompe.
//
// Es la pieza que convierte la verificabilidad en algo VISCERAL: en lugar de
// devolver "inválido", el replay dice "la línea 3 fue cambiada de X a Y". Ningún
// competidor emite esto porque primero necesita la cadena de hashes sobre el audit.

import { buildChain, toLines } from '../audit/audit_chain.js';
import type { SignedProvenance } from './provenance_v2.js';

export interface ReplayResult {
  valid: boolean;
  /** Índice 0-based de la primera línea adulterada, si hay divergencia. */
  divergeAtLine?: number;
  originalLine?: string;
  tamperedLine?: string;
  /** Total de líneas del audit original. */
  totalLines: number;
  reason: 'ok' | 'no_audit_embedded' | 'tampered_line' | 'length_mismatch';
}

/**
 * Replay del audit embebido contra un texto candidato.
 *
 * - Si candidateAudit === auditLog original: ok.
 * - Si una línea fue editada: divergeAtLine = índice exacto de esa línea.
 * - Si se insertaron/borraron líneas: length_mismatch con divergeAtLine = primer
 *   índice fuera de rango.
 *
 * La identificación exacta de línea es posible gracias a audit_chain.ts: el
 * chainHash de la línea N depende de las N-1 anteriores, así que la primera
 * divergencia en la cadena = la primera línea adulterada.
 */
export function replayProvenance(pkg: SignedProvenance, candidateAudit: string): ReplayResult {
  if (pkg.auditLog === undefined) {
    return { valid: false, reason: 'no_audit_embedded', totalLines: 0 };
  }

  const originalLines = toLines(pkg.auditLog);
  const candidateLines = toLines(candidateAudit);
  const totalLines = originalLines.length;

  const originalChain = buildChain(originalLines);
  const candidateChain = buildChain(candidateLines);

  const min = Math.min(originalChain.length, candidateChain.length);
  for (let i = 0; i < min; i++) {
    if (candidateChain[i].chainHash !== originalChain[i].chainHash) {
      return {
        valid: false,
        divergeAtLine: i,
        originalLine: originalLines[i],
        tamperedLine: candidateLines[i],
        totalLines,
        reason: 'tampered_line',
      };
    }
  }

  if (originalLines.length !== candidateLines.length) {
    return { valid: false, divergeAtLine: min, totalLines, reason: 'length_mismatch' };
  }

  return { valid: true, totalLines, reason: 'ok' };
}

/**
 * Construye un resumen de texto del replay para el briefing/demo.
 * Ejemplo: "✅ líneas 1–12 íntegras" o "❌ divergencia en línea 4 (de 12)"
 */
export function summarizeReplay(r: ReplayResult): string {
  if (r.reason === 'no_audit_embedded') return '⚠️ sin audit embebido — verificación parcial';
  if (r.valid) return `✅ ${r.totalLines} líneas íntegras`;
  if (r.reason === 'length_mismatch') {
    return `❌ longitud modificada (divergencia en línea ${(r.divergeAtLine ?? 0) + 1} de ${r.totalLines})`;
  }
  const n = (r.divergeAtLine ?? 0) + 1;
  return `❌ divergencia en línea ${n} de ${r.totalLines}`;
}
