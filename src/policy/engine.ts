// P4 (Policy como Código) — motor de resolución del mandato por misión.
//
// E3.b dejó la EMISIÓN del mandato "operador-controlada": el operador fijaba
// `SHINOBI_MANDATE` a mano. P4 cierra ese hueco: una POLICY declarativa decide el
// mínimo por misión. Fail-closed por construcción — sin policy válida, deny-all
// (mandato vacío), nunca "abierto por omisión". Es el `si hay elección no hay
// libertad` aplicado: una policy decidida y enforced, no un menú de defaults sueltos.
//
// Precedencia (resolveMissionMandate): SHINOBI_POLICY (fichero) > SHINOBI_MANDATE
// (env crudo de E3.b, back-compat) > undefined (rama legado, default-off).

import type { Mandate } from '../sandbox/mandate.js';
import { parseMandateSpec } from '../sandbox/mandate.js';
import { readFileSync } from 'fs';
import { verifyPolicySignature } from './policy_sign.js';
import { resolve } from 'path';

export interface Policy {
  /** Capacidades por defecto para cualquier misión sin perfil específico. */
  readonly default: readonly string[];
  /** Perfiles nombrados: cada uno un conjunto de capacidades `"kind:scope"`. */
  readonly profiles?: Readonly<Record<string, readonly string[]>>;
  /** TTL del mandato en ms; ausente/0 ⇒ sin caducidad. */
  readonly ttlMs?: number;
}

/** Policy fail-closed: cero capacidades. Es el default seguro si no hay fichero válido. */
export const DENY_ALL_POLICY: Policy = { default: [] };

/**
 * Resuelve el `Mandate` de una misión desde la policy y su contexto. Fail-closed:
 * perfil desconocido ⇒ cae al `default`; sin `default` ⇒ mandato vacío (deny-all).
 * Puro (`now` inyectable). Sustituye al `SHINOBI_MANDATE` crudo: la policy decide el
 * mínimo por misión, no el operador a mano.
 */
export function resolveMandate(policy: Policy, ctx: { profile?: string } = {}, now: number = Date.now()): Mandate {
  const caps = (ctx.profile && policy.profiles?.[ctx.profile]) || policy.default || [];
  const ttl = policy.ttlMs;
  const expiresAt = ttl !== undefined && Number.isFinite(ttl) && ttl > 0 ? now + ttl : undefined;
  return { capabilities: [...caps], expiresAt };
}

/** Carga la policy de un JSON. Fichero ausente/ilegible/ inválido ⇒ DENY_ALL (fail-closed). */
export function loadPolicy(path?: string): Policy {
  const p = path ?? process.env.SHINOBI_POLICY;
  if (!p) return DENY_ALL_POLICY;
  try {
    const raw = JSON.parse(readFileSync(resolve(p), 'utf-8'));
    if (!raw || !Array.isArray(raw.default)) return DENY_ALL_POLICY;
    const policy: Policy = {
      default: raw.default.filter((c: unknown) => typeof c === 'string'),
      profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : undefined,
      ttlMs: typeof raw.ttlMs === 'number' ? raw.ttlMs : undefined,
    };
    // P4 — si el operador EXIGE policy firmada, verificar la firma embebida; si falta
    // o no valida ⇒ DENY_ALL (fail-closed). Sin el flag, se carga sin firma (back-compat).
    if (process.env.SHINOBI_POLICY_REQUIRE_SIGNATURE === '1') {
      const sig = raw.signature;
      if (!sig || typeof sig.signature !== 'string' || typeof sig.publicKeyPem !== 'string' || !verifyPolicySignature(policy, sig)) {
        return DENY_ALL_POLICY;
      }
    }
    return policy;
  } catch {
    return DENY_ALL_POLICY;
  }
}

/**
 * Emisión del mandato por misión con precedencia policy > env > legado. Devuelve
 * `undefined` (rama legado, default-off) SOLO si no hay ni policy ni `SHINOBI_MANDATE`.
 */
export function resolveMissionMandate(): Mandate | undefined {
  if (process.env.SHINOBI_POLICY) {
    return resolveMandate(loadPolicy(), { profile: process.env.SHINOBI_MISSION_PROFILE });
  }
  return parseMandateSpec(process.env.SHINOBI_MANDATE, {
    ttlMs: process.env.SHINOBI_MANDATE_TTL_MS ? Number(process.env.SHINOBI_MANDATE_TTL_MS) : undefined,
  });
}
