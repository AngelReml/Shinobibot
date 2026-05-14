/**
 * Failover cross-provider — clasifica el error de un provider y decide si
 * rotar al siguiente en la cadena.
 *
 * Diferencia clave vs OpenClaw (retry-limit + failover-policy) y vs el
 * comportamiento legacy de Shinobi (opengravity → openrouter solo en
 * connection error): aquí la cadena es **configurable** y la decisión de
 * rotar se basa en una **clasificación explícita** del error, no en regex
 * ad-hoc dentro del router.
 */

import type { ProviderName } from './types.js';

/**
 * 'no_key'        — el provider está en la cadena pero su variable de entorno
 *                   no está configurada. Rota silencioso (no es un fallo,
 *                   solo no está disponible).
 * 'transient'     — error de red, timeout, 5xx. Rota con log.
 * 'rate_limit'    — 429 / quota / "rate limit". Rota con log.
 * 'auth'          — 401, key inválida. Rota con log (la siguiente puede tener
 *                   otra key) pero deja claro en el log que la key falló.
 * 'fatal_payload' — 400 sobre formato (tool schema, messages malformados).
 *                   No rota: rotar daría el mismo error en otro provider.
 * 'unknown'       — cualquier otra cosa. Rota con log.
 */
export type ErrorClass =
  | 'no_key'
  | 'transient'
  | 'rate_limit'
  | 'auth'
  | 'fatal_payload'
  | 'unknown';

export function classifyProviderError(error: string | undefined): ErrorClass {
  if (!error) return 'unknown';
  const e = error.toLowerCase();

  // 1) Ausencia de key configurada → rotar silencioso.
  if (
    /no\s*est[áa]\s*definida/i.test(error) ||
    /missing\s+(api\s+)?key/i.test(error) ||
    /api\s+key\s+not\s+set/i.test(error)
  ) {
    return 'no_key';
  }

  // 2) Rate limit / cuota.
  if (
    /\b429\b/.test(e) ||
    /rate[\s_-]?limit/.test(e) ||
    /quota\s+exceed/.test(e) ||
    /too\s+many\s+requests/.test(e)
  ) {
    return 'rate_limit';
  }

  // 3) Errores de red / transitorios.
  if (
    /econnrefused|enotfound|etimedout|socket\s+hang\s+up/.test(e) ||
    /connection\s+(error|reset|closed)/.test(e) ||
    /timeout/.test(e) ||
    /\b5\d{2}\b/.test(error) ||
    /service\s+unavailable|bad\s+gateway|gateway\s+timeout/.test(e)
  ) {
    return 'transient';
  }

  // 4) Auth (401, key inválida).
  if (
    /\b401\b/.test(e) ||
    /inv[aá]lid(a)?\s+(api\s+)?key/.test(e) ||
    /unauthorized/.test(e) ||
    /invalid\s+credentials/.test(e)
  ) {
    return 'auth';
  }

  // 5) Fatal de payload (no merece rotar — fallaría igual en otros).
  if (
    /\b400\b/.test(error) &&
    (/tool/.test(e) ||
      /function/.test(e) ||
      /schema/.test(e) ||
      /messages/.test(e) ||
      /invalid\s+format/.test(e) ||
      /role/.test(e))
  ) {
    return 'fatal_payload';
  }

  return 'unknown';
}

/**
 * Devuelve true si el error justifica rotar al siguiente provider.
 * 'fatal_payload' es el único veredicto que NO rota.
 */
export function shouldFailover(klass: ErrorClass): boolean {
  return klass !== 'fatal_payload';
}

/**
 * Construye la cadena de providers a probar.
 *
 *   - Si el usuario define `SHINOBI_FAILOVER_CHAIN` (CSV) la usamos tal cual.
 *   - Si no, default sensato: `current` primero, luego el resto en orden
 *     `[opengravity, openrouter, groq, anthropic, openai]` (skip duplicado).
 *
 * Sin duplicados; preserva el orden.
 */
export function buildFailoverChain(current: ProviderName, envChain?: string): ProviderName[] {
  const valid: ProviderName[] = ['groq', 'openai', 'anthropic', 'openrouter', 'opengravity'];

  if (envChain && envChain.trim()) {
    const parsed = envChain
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0)
      .filter((s): s is ProviderName => (valid as string[]).includes(s));
    // Dedup preservando orden.
    const seen = new Set<ProviderName>();
    const out: ProviderName[] = [];
    for (const p of parsed) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    // Aseguramos que el current está al frente.
    if (out.length > 0 && out[0] !== current) {
      const filtered = out.filter(p => p !== current);
      return [current, ...filtered];
    }
    return out.length > 0 ? out : [current];
  }

  const defaultOrder: ProviderName[] = ['opengravity', 'openrouter', 'groq', 'anthropic', 'openai'];
  const seen = new Set<ProviderName>();
  const chain: ProviderName[] = [];
  for (const p of [current, ...defaultOrder]) {
    if (!seen.has(p)) {
      seen.add(p);
      chain.push(p);
    }
  }
  return chain;
}

/**
 * Etiqueta humana para el log de rotación.
 */
export function reasonLabel(klass: ErrorClass): string {
  switch (klass) {
    case 'no_key': return 'no key configurada';
    case 'rate_limit': return 'rate limit';
    case 'transient': return 'error transitorio';
    case 'auth': return 'auth failed';
    case 'fatal_payload': return 'payload inválido';
    default: return 'error desconocido';
  }
}
