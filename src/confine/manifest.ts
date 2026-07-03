// P3 (Runtime de Confinamiento) — manifiesto de capacidades de código foráneo.
//
// Cada skill/plugin declara QUÉ necesita: capacidades `"kind:scope"` (la MISMA
// gramática que los mandatos de P1 — no una segunda). La idea del Pilar 3: el
// manifiesto de una skill ES su mandato — corre con exactamente lo declarado y el
// monitor (mediatedEffect) le deniega todo lo demás. `least-privilege por declaración`.
// Fail-closed: una capacidad malformada se DESCARTA (no se concede por accidente).

import type { Mandate } from '../sandbox/mandate.js';

export interface CapabilityManifest {
  readonly name: string;
  readonly capabilities: readonly string[];
}

/** Formato válido de capacidad declarada: `kind:scope` con kind conocido y scope no vacío. */
const CAP_RE = /^(shell|fs\.read|fs\.write|net|input):.+$/;

/**
 * Valida y normaliza el manifiesto crudo (de un `.md`/JSON). Devuelve `null` si no hay
 * nombre o `capabilities` no es lista. Las capacidades malformadas se descartan
 * (fail-closed): lo que no está bien declarado no se concede.
 */
export function parseManifest(raw: unknown): CapabilityManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { name?: unknown; capabilities?: unknown };
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  if (!Array.isArray(o.capabilities)) return null;
  const capabilities = o.capabilities.filter((c: unknown): c is string => typeof c === 'string' && CAP_RE.test(c));
  return { name: o.name, capabilities };
}

/**
 * El manifiesto ES el mandato: la skill corre con exactamente las capacidades que
 * declaró. `ttlMs>0` fija caducidad. Es lo que conecta P3 (declaración) con P1
 * (enforcement): `runWithMandate(manifestToMandate(m), () => cargar la skill)`.
 */
export function manifestToMandate(manifest: CapabilityManifest, ttlMs?: number, now: number = Date.now()): Mandate {
  const expiresAt = ttlMs !== undefined && Number.isFinite(ttlMs) && ttlMs > 0 ? now + ttlMs : undefined;
  return { capabilities: [...manifest.capabilities], expiresAt };
}
