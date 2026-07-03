// P1.E3 (plan de frontera 2026-07-01) — Mandatos de capacidad: `checkMandate()`.
//
// El Pilar 1 promete least-privilege POR MISIÓN: una misión arranca con un
// conjunto de capacidades y el monitor RECHAZA cualquier efecto fuera de ese
// conjunto. E1-E2 dejó el hook (`mediatedEffect(effect, mandate?)`) pero pasar un
// mandato DENEGABA en bloque (`mandate_not_enforceable`): fail-closed antes que
// fingir. Esta etapa (E3.a) implementa el enforcement real y retira aquella
// negación en bloque.
//
//   QUÉ HACE E3.a (este fichero + el wiring del monitor):
//   - Modela la capacidad como un dato: el string `"kind:scope"` — la misma forma
//     que el plan de frontera usa en sus ejemplos (`shell:workspace`,
//     `net:api.anthropic.com`, `fs.write:./out`) y que el contrato público del
//     monitor ya aceptaba. `kind` es un `EffectKind`; `scope` acota QUÉ dentro de
//     ese kind (un cwd/prefijo para shell/fs, un host para net, `*` comodín).
//   - `checkMandate(effect, mandate)` es PURO (sin IO, sin env, sin reloj salvo el
//     `now` inyectable): decide `granted` comparando la capacidad que el efecto
//     REQUIERE contra las que el mandato CONCEDE. Al ser puro es trivialmente
//     verificable por mutación (romper la comparación ⇒ un efecto no cubierto
//     pasaría ⇒ el test se pone rojo).
//   - Alineado con el vocabulario que kaname ya usa para skills
//     (`mediator.ts::scoped()` / `effectWithin()`): membresía + scope, no una
//     segunda gramática divergente. La diferencia es la capa: kaname media
//     syscalls de una skill EN PROCESO; el monitor media EFECTOS de ejecución
//     (shell/fs/net/input). Misma idea, distinto sujeto.
//
//   QUÉ NO HACE (declarado sin adornos, fail-closed en lo no construido):
//   - No FIRMA el mandato. El plan pide un mandato firmado con la clave de
//     dispositivo (Pilar 2); esa clave (P2.E1 `device_identity`) aún no existe.
//     E3.a emite/enforcea/audita el mandato SIN firma; elevarlo a firma Ed25519 es
//     E3.c, y depende de P2. No se finge una firma que no está.
//   - EMISIÓN por misión (E3.b): operador-controlada. `parseMandateSpec` lee
//     `SHINOBI_MANDATE` de la config y `ShinobiOrchestrator.process` envuelve la
//     misión en `runWithMandate`. Default-off: sin config ⇒ paridad legado total.
//     Lo que queda para P4 es DERIVAR el mínimo por misión automáticamente (hoy lo
//     fija el operador a conciencia), no el mecanismo — que ya está vivo.
//   - No FIRMA aún (E3.c): elevar el mandato a firma Ed25519 depende de P2.

import type { Effect, EffectKind } from './monitor.js';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Un mandato: el conjunto de capacidades concedidas a una misión, con caducidad
 * opcional. La firma pública del monitor ya lo aceptaba en E1-E2 (entonces solo
 * para denegar); E3.a le da semántica real.
 *
 * `capabilities`: strings `"kind:scope"`. Ver `checkMandate` para el álgebra de
 * cobertura. `expiresAt`: epoch ms; a partir de ahí el mandato no concede nada
 * (fail-closed), forzando re-emisión — es el "con caducidad" del plan.
 */
export interface Mandate {
  readonly capabilities: readonly string[];
  readonly expiresAt?: number;
}

/** Veredicto de `checkMandate`. Los códigos coinciden con `EffectDenialCode`. */
export type MandateVerdict =
  | { readonly granted: true }
  | { readonly granted: false; readonly code: 'capability_not_granted' | 'mandate_expired'; readonly detail: string };

/**
 * La capacidad que un efecto REQUIERE: su `kind` y el `scope` que toca. Puro:
 * deriva el scope del propio dato del efecto, sin resolver rutas contra el disco
 * (eso lo hará, si hace falta, la policy de P4 al construir el mandato).
 *   - shell            → el `cwd` donde corre (dónde puede actuar)
 *   - fs.read/fs.write → la ruta objetivo
 *   - net              → el host/url objetivo
 *   - input            → el descriptor de dispositivo (o vacío)
 */
export function effectScope(effect: Effect): string {
  if (effect.kind === 'shell') return effect.cwd;
  return effect.target ?? '';
}

/**
 * ¿La capacidad concedida `grant` cubre el `scope` requerido por el efecto?
 *   - `*`              cubre cualquier scope de ese kind (comodín explícito).
 *   - igualdad exacta  cubre.
 *   - prefijo de ruta CON frontera de separador: `grant="/ws"` cubre `/ws` y
 *     `/ws/sub`, pero NO `/ws-secretos` — evita por construcción el bug de
 *     prefijo suelto (`scratch` cubriendo `scratch-evil`) que la auditoría marcó
 *     en `validatePath`. Para hosts/descriptores sin `/`, degrada a igualdad.
 */
export function scopeCovers(grant: string, effScope: string): boolean {
  if (grant === '*') return true;
  if (grant === effScope) return true;
  const g = grant.endsWith('/') ? grant.slice(0, -1) : grant;
  return effScope === g || effScope.startsWith(g + '/');
}

/**
 * ¿El mandato concede la capacidad `(kind, scope)`? Núcleo de cobertura COMPARTIDO por
 * `checkMandate`, `effectsWithinMandate` y el dry-run de P4 — una sola fuente de verdad
 * de cobertura, sin gramáticas divergentes. Ignora la caducidad (la mira `checkMandate`).
 */
export function mandateCovers(mandate: Mandate, kind: string, scope: string): boolean {
  return mandate.capabilities.some((cap) => {
    const i = cap.indexOf(':');
    if (i < 0) return false;
    return cap.slice(0, i) === kind && scopeCovers(cap.slice(i + 1), scope);
  });
}

/**
 * ¿El mandato concede el efecto? Puro y fail-closed:
 *   1. Mandato caducado (`expiresAt` en el pasado) ⇒ no concede NADA.
 *   2. El efecto se concede solo si ALGUNA capacidad `"kind:scope"` tiene el mismo
 *      kind y un scope que cubre el del efecto. Si ninguna ⇒ `capability_not_granted`.
 * Una capacidad malformada (sin `:`) se IGNORA — nunca concede por accidente.
 *
 * `now` es inyectable solo para poder testear la caducidad de forma determinista.
 */
export function checkMandate(effect: Effect, mandate: Mandate, now: number = Date.now()): MandateVerdict {
  if (mandate.expiresAt !== undefined && now >= mandate.expiresAt) {
    return {
      granted: false,
      code: 'mandate_expired',
      detail: `mandato caducado (expiresAt=${mandate.expiresAt}, now=${now}): re-emisión requerida`,
    };
  }
  const needKind: EffectKind = effect.kind;
  const needScope = effectScope(effect);
  if (mandateCovers(mandate, needKind, needScope)) return { granted: true };
  return {
    granted: false,
    code: 'capability_not_granted',
    detail: `efecto '${needKind}:${needScope}' no cubierto por el mandato [${mandate.capabilities.join(', ') || '∅'}]`,
  };
}

/** Un efecto ya ejecutado tal como lo registra un Recibo de Misión: kind + scope + decisión. */
export interface ExecutedEffect {
  readonly kind: string;
  readonly scope: string;
  readonly decision: 'allow' | 'deny';
}

/**
 * ¿Todos los efectos PERMITIDOS de una misión caben en su mandato? Es la prueba
 * central del "Modo Cristal" (P2.E5): con enforcement correcto (E3.a), ningún efecto
 * permitido debería exceder el mandato — si un verificador encuentra uno que sí, es
 * evidencia de que el gate se saltó o rompió. Los efectos DENEGADOS no cuentan (no
 * ocurrieron). Verifica COBERTURA histórica (reusa `scopeCovers`), no la caducidad
 * (que es sobre validez presente, no sobre si un efecto pasado estaba cubierto). Puro.
 */
export function effectsWithinMandate(
  effects: readonly ExecutedEffect[],
  mandate: Mandate,
): { ok: boolean; offending?: ExecutedEffect } {
  for (const e of effects) {
    if (e.decision !== 'allow') continue;
    if (!mandateCovers(mandate, e.kind, e.scope)) return { ok: false, offending: e };
  }
  return { ok: true };
}

/**
 * Emisor pre-P4 (operador-controlado): parsea la especificación de mandato de la
 * config (`SHINOBI_MANDATE`) — capacidades separadas por comas, p.ej.
 * "shell:*,fs.read:/data" — en un `Mandate`. Vacío/undefined ⇒ undefined (rama
 * legado, sin enforcement). `ttlMs>0` fija `expiresAt = now + ttlMs`. Puro (`now`
 * inyectable). P4 lo sustituirá por derivación del mínimo por misión; hasta
 * entonces es el gancho para que el operador active least-privilege a conciencia.
 */
export function parseMandateSpec(
  spec: string | undefined,
  opts: { ttlMs?: number; now?: number } = {},
): Mandate | undefined {
  if (!spec) return undefined;
  const capabilities = spec.split(',').map((c) => c.trim()).filter((c) => c.length > 0);
  if (capabilities.length === 0) return undefined;
  const now = opts.now ?? Date.now();
  const expiresAt =
    opts.ttlMs !== undefined && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? now + opts.ttlMs : undefined;
  return { capabilities, expiresAt };
}

// ── Transporte del mandato por misión (mecanismo de E3.b, DORMIDO por defecto) ────
//
// El mandato "por misión" viaja por un AsyncLocalStorage propio — el mismo patrón
// que `agents/exec_context.ts` usa para el cwd por agente, y por la misma razón:
// aislar sesiones concurrentes sin estado global. Ponerlo aquí (capa sandbox, sin
// importar `agents/`) evita una inversión de capas y deja al monitor leerlo sin
// depender de subsistemas superiores.
//
// DEFAULT-OFF: `ShinobiOrchestrator.process` llama `runWithMandate` SOLO si el
// operador fijó `SHINOBI_MANDATE` (E3.b). Sin él, `currentMandate()` es `undefined`
// y el monitor cae en la rama legado: cero cambio de comportamiento (paridad). El
// contexto de misión además RECOGE los efectos mediados para el Recibo de Misión
// (P2.E5): `recordMissionEffect` los acumula y el cierre de la misión los firma.

interface MissionContext {
  readonly mandate: Mandate;
  readonly effects: ExecutedEffect[];
}

const mandateStore = new AsyncLocalStorage<MissionContext>();

/** Ejecuta `fn` bajo un mandato de misión activo (lo consume el monitor). */
export function runWithMandate<T>(mandate: Mandate, fn: () => Promise<T>): Promise<T> {
  return mandateStore.run({ mandate, effects: [] }, fn);
}

/** El mandato de misión activo, o `undefined` si no hay ninguno (rama legado). */
export function currentMandate(): Mandate | undefined {
  return mandateStore.getStore()?.mandate;
}

/** Registra un efecto mediado en la misión activa. No-op fuera de una misión con mandato. */
export function recordMissionEffect(e: ExecutedEffect): void {
  mandateStore.getStore()?.effects.push(e);
}

/** Los efectos recogidos de la misión activa (para el Recibo de Misión), o `undefined`. */
export function currentMissionEffects(): readonly ExecutedEffect[] | undefined {
  return mandateStore.getStore()?.effects;
}
