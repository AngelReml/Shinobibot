/**
 * Skill Integrity Checksum & Provenance (F3.2, terminología corregida
 * 2026-07: este módulo NUNCA fue una "firma" en el sentido de autenticación
 * de autor — la promesa original ("Skill Signing") estaba desalineada con
 * lo que el mecanismo realmente garantiza. Se documenta aquí sin cambiar la
 * API pública (los nombres `sign*`/`verifySkill*`/`signature_hash` se
 * mantienen por compatibilidad — ver nota de terminología abajo).
 *
 * QUÉ ES: un checksum SHA256 del contenido normalizado (frontmatter
 * excluyendo los campos de checksum + body) más metadata de provenance
 * (quién lo generó según ese mismo actor, cuándo). Al cargar la skill,
 * recalculamos el hash y rechazamos si no coincide. Detecta:
 *
 *     - tampering del body (el caso más común — alguien editó SKILL.md
 *       fuera del flujo de aprobación)
 *     - tampering del frontmatter (cambio de trigger_keywords, etc.)
 *     - skills sin checksum (legacy o copy-paste de otro proyecto)
 *
 * QUÉ NO ES — NO es PKI, NO es una firma criptográfica, NO autentica al
 * autor: no hay clave privada de nadie, ni verificación de identidad. El
 * campo `signed_by` es un STRING LIBRE que quien genera el checksum puede
 * poner a su antojo ('auto', 'user', o cualquier otro valor) — no es una
 * afirmación verificable de autoría, solo una anotación de provenance
 * declarada. Cualquier código o mensaje de usuario que lea "firmado por X"
 * como "X garantizó criptográficamente que escribió esto" está mal —
 * la garantía real es únicamente: "el contenido no cambió desde que ESTE
 * proceso calculó el hash".
 *
 * Es decir: checksum de integridad + provenance declarada, no autenticación
 * de autor. Eso ya basta para cerrar el agujero de Hermes (audit #5:
 * "Skills que se auto-crean no tienen version control evidente; Curator
 * auto-archive sin confirmación explícita") — que es un problema de
 * INTEGRIDAD (¿cambió el contenido?), no de AUTENTICACIÓN (¿quién lo
 * escribió realmente?). No confundir los dos.
 *
 * Ed25519 real: el repo SÍ tiene firma criptográfica real en otro
 * subsistema — `src/shitsuji/live.ts` firma la cadena TEV (Trace de
 * Efectos Verificables) con `crypto.generateKeyPairSync('ed25519')` para
 * que un tercero verifique la traza sin confiar en Shinobi. Investigado
 * como parte de F3.2 (opción L): reusar esa clave aquí para firmar el
 * checksum de skills NO es trivial — esa clave vive en el ciclo de vida de
 * shitsuji (par efímero/persistido por sesión de ejecución, pensado para
 * firmar EVENTOS de una traza, no ARTEFACTOS de skill), y darle ese segundo
 * uso tocaría el diseño de gestión de claves de un módulo fuera de este
 * alcance. Además, aun con Ed25519 real aquí, la clave privada la tendría
 * el propio Shinobi (no un autor humano externo) — seguiría sin resolver
 * "autenticación de autor", solo añadiría una capa de integridad
 * redundante con el hash ya presente. Se deja como mejora futura si algún
 * día hay necesidad real de autenticar autoría de terceros (marketplace de
 * skills firmadas por su creador humano, por ejemplo).
 *
 * Campos de checksum/provenance (todos en el frontmatter; nombres
 * heredados de la promesa original "signing" — no se renombran para no
 * romper skills ya escritas en disco con este frontmatter):
 *   signature_hash : sha256 (hex, 64 chars) del contenido normalizado
 *   signed_at      : ISO8601 timestamp de cuándo se calculó el checksum
 *   signed_by      : provenance declarada — 'auto' (skill manager) | 'user' | string libre (NO verificado)
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

/** Nombres heredados de la promesa original "signing" — ver banner del
 *  módulo: esto es checksum + provenance declarada, no una firma criptográfica. */
export const SIGNATURE_FIELDS = ['signature_hash', 'signed_at', 'signed_by'] as const;

export interface VerifyResult {
  /** true si el checksum coincide con el contenido actual (integridad
   *  intacta) — NO significa "autor verificado". */
  valid: boolean;
  /** Razón cuando valid=false; ausente si valid=true. */
  reason?: 'missing_signature' | 'hash_mismatch' | 'parse_error';
  expectedHash?: string;
  actualHash?: string;
}

export interface SignOptions {
  /** Provenance declarada por el actor que genera el checksum — string
   *  libre, NO verificado criptográficamente. default 'auto'. */
  author?: string;
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
 * Calcula el checksum de integridad de un ParsedSkill y añade
 * signature_hash + signed_at + signed_by (provenance declarada, NO
 * verificada) al frontmatter. Devuelve el ParsedSkill resultante. NO muta
 * el input. (Nombre heredado — no es una firma criptográfica, ver banner.)
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
 * Calcula el checksum de una skill ya serializada como texto SKILL.md.
 * Devuelve el texto con el checksum/provenance embebidos, listo para
 * escribir a disco. (Nombre heredado — checksum, no firma criptográfica.)
 */
export function signSkillText(text: string, opts: SignOptions = {}): string {
  const parsed = parseSkillMd(text);
  const signed = signSkill(parsed, opts);
  return serializeSkillMd(signed);
}

/**
 * Verifica el checksum de integridad de una skill. Devuelve {valid,
 * reason?}. valid=true solo si signature_hash existe y coincide con el
 * hash recomputado — esto confirma que el contenido no cambió desde que se
 * calculó, NO que el `signed_by` declarado sea el autor real.
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
 * Verifica el checksum de integridad de una skill desde texto. Devuelve
 * {valid, reason?}. parse_error se devuelve si el texto no parsea como
 * SKILL.md.
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
 * Helper de conveniencia: devuelve solo los 3 campos de checksum/provenance
 * declarada de un frontmatter, útil para logs/UI. Al mostrarlos en UI, usar
 * fraseo tipo "checksum verificado, provenance declarada por X" — NUNCA
 * "firmado y verificado por X" (implicaría autenticación que no existe).
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
