/**
 * Skill Signing & Provenance.
 *
 * Diseño:
 *   Cada skill aprobada lleva un hash SHA256 del contenido normalizado
 *   (frontmatter excluyendo los campos de firma + body). Al cargar la
 *   skill, recalculamos el hash y rechazamos si no coincide. Detecta:
 *
 *     - tampering del body (el caso más común — alguien editó SKILL.md
 *       fuera del flujo de aprobación)
 *     - tampering del frontmatter (cambio de trigger_keywords, etc.)
 *     - skills sin firma (legacy o copy-paste de otro proyecto)
 *
 * No es PKI — no hay clave privada del autor. Es un checksum + provenance
 * (quién, cuándo) registrado en el propio frontmatter. Eso ya basta para
 * cerrar el agujero de Hermes (audit #5: "Skills que se auto-crean no
 * tienen version control evidente; Curator auto-archive sin confirmación
 * explícita").
 *
 * Campos de firma (todos en el frontmatter):
 *   signature_hash : sha256 (hex, 64 chars) del contenido normalizado
 *   signed_at      : ISO8601 timestamp
 *   signed_by      : autor — 'auto' (skill manager) | 'user' | string libre
 *
 * Estos tres campos NO entran en el hash (obviamente). Cualquier otra
 * clave del frontmatter sí.
 */

import { createHash } from 'crypto';
import {
  parseSkillMd,
  serializeSkillMd,
  type ParsedSkill,
  type SkillFrontmatter,
} from './skill_md_parser.js';

export const SIGNATURE_FIELDS = ['signature_hash', 'signed_at', 'signed_by'] as const;

export interface VerifyResult {
  valid: boolean;
  /** Razón cuando valid=false; ausente si valid=true. */
  reason?: 'missing_signature' | 'hash_mismatch' | 'parse_error';
  expectedHash?: string;
  actualHash?: string;
}

export interface SignOptions {
  author?: string; // default 'auto'
  /** Override para tests determinísticos. Default: new Date().toISOString(). */
  now?: () => string;
}

/**
 * Calcula el hash canónico del contenido de una skill, excluyendo los
 * campos de firma. La canonicalización es estable: claves del frontmatter
 * ordenadas alfabéticamente, valores normalizados (arrays como JSON, otros
 * como String).
 */
export function computeSkillHash(parsed: ParsedSkill): string {
  const fm = parsed.frontmatter;
  const keys = Object.keys(fm)
    .filter(k => !SIGNATURE_FIELDS.includes(k as any))
    .sort();
  const canonicalParts: string[] = [];
  for (const k of keys) {
    const v = fm[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      canonicalParts.push(`${k}=${JSON.stringify(v.map(String))}`);
    } else {
      canonicalParts.push(`${k}=${String(v)}`);
    }
  }
  // Body normalizado: trim + trailing newlines colapsados.
  const body = (parsed.body || '').replace(/\s+$/g, '');
  const material = canonicalParts.join('\n') + '\n---BODY---\n' + body;
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Firma un ParsedSkill: añade signature_hash + signed_at + signed_by al
 * frontmatter y devuelve el ParsedSkill resultante. NO muta el input.
 */
export function signSkill(parsed: ParsedSkill, opts: SignOptions = {}): ParsedSkill {
  const author = opts.author ?? 'auto';
  const now = opts.now ? opts.now() : new Date().toISOString();
  // Hash sobre el contenido SIN los campos de firma.
  const unsigned: ParsedSkill = {
    frontmatter: { ...parsed.frontmatter },
    body: parsed.body,
  };
  for (const f of SIGNATURE_FIELDS) delete unsigned.frontmatter[f];
  const hash = computeSkillHash(unsigned);
  return {
    frontmatter: {
      ...unsigned.frontmatter,
      signature_hash: hash,
      signed_at: now,
      signed_by: author,
    },
    body: unsigned.body,
  };
}

/**
 * Firma una skill ya serializada como texto SKILL.md. Devuelve el texto
 * firmado listo para escribir a disco.
 */
export function signSkillText(text: string, opts: SignOptions = {}): string {
  const parsed = parseSkillMd(text);
  const signed = signSkill(parsed, opts);
  return serializeSkillMd(signed);
}

/**
 * Verifica una skill firmada. Devuelve {valid, reason?}. valid=true solo
 * si signature_hash existe y coincide con el hash recomputado.
 */
export function verifySkill(parsed: ParsedSkill): VerifyResult {
  const fm = parsed.frontmatter;
  const provided = fm.signature_hash;
  if (!provided || typeof provided !== 'string' || provided.length !== 64) {
    return { valid: false, reason: 'missing_signature' };
  }
  const unsigned: ParsedSkill = {
    frontmatter: { ...fm },
    body: parsed.body,
  };
  for (const f of SIGNATURE_FIELDS) delete unsigned.frontmatter[f];
  const expected = computeSkillHash(unsigned);
  if (expected !== provided) {
    return {
      valid: false,
      reason: 'hash_mismatch',
      expectedHash: expected,
      actualHash: provided,
    };
  }
  return { valid: true };
}

/**
 * Verifica una skill desde texto. Devuelve {valid, reason?}. parse_error
 * se devuelve si el texto no parsea como SKILL.md.
 */
export function verifySkillText(text: string): VerifyResult {
  try {
    const parsed = parseSkillMd(text);
    return verifySkill(parsed);
  } catch {
    return { valid: false, reason: 'parse_error' };
  }
}

/**
 * Helper de conveniencia: devuelve solo los 3 campos de firma de un
 * frontmatter, útil para logs/UI.
 */
export function extractProvenance(fm: SkillFrontmatter): {
  hash?: string;
  signedAt?: string;
  signedBy?: string;
} {
  return {
    hash: typeof fm.signature_hash === 'string' ? fm.signature_hash : undefined,
    signedAt: typeof fm.signed_at === 'string' ? fm.signed_at : undefined,
    signedBy: typeof fm.signed_by === 'string' ? fm.signed_by : undefined,
  };
}
