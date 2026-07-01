// src/browser/consent.ts
// Mejora 5: consentimiento específico del navegador, INDEPENDIENTE del gate
// global (que está desactivado por FIX-002). Política propia: ante acciones
// sensibles se pregunta, y si no hay respuesta a tiempo se DENIEGA (lo contrario
// al gate global, que aprueba por timeout). Ver docs/BROWSER_SUBSYSTEM.md §1.5.
//
// F4.5 (2026-07-01) — ASIMETRÍA DE FAIL-SAFE documentada y confirmada por test
// (consent_timeout_symmetry.test.ts):
//   - src/browser/consent.ts (ESTE archivo): fail-CLOSED por defecto. Si el
//     asker no responde en KAGE_CONSENT_TIMEOUT_MS (default 60s), o si no hay
//     asker registrado en absoluto, la acción se DENIEGA. Ver
//     requestBrowserConsent() más abajo: la promesa de timeout resuelve
//     `false` (deny), nunca `true`.
//   - src/security/approval.ts (gate global, otro track, NO tocado aquí):
//     SHINOBI_APPROVAL_TIMEOUT_ACTION es configurable y puede valer 'approve'
//     — es decir, el gate global puede ser fail-OPEN por configuración ante
//     timeout, mientras que este archivo es fail-CLOSED siempre, sin opción
//     de configurarlo hacia fail-open.
// Esto es una asimetría real entre dos capas de aprobación del mismo agente.
// No se corrige aquí (approval.ts pertenece a otro track/PR de seguridad) —
// se deja documentado y reportado para que ese track decida si
// SHINOBI_APPROVAL_TIMEOUT_ACTION debería perder la opción 'approve' o si la
// asimetría es intencional (gate global cubre acciones de bajo riesgo,
// consent de navegador cubre acciones de alto riesgo — pago/login/nueva
// navegación). Ver DECISIONES.md para el hallazgo cruzado.

import type { ActCommand } from './types.js';
import type { ElementRef } from './types.js';

export type ConsentMode = 'off' | 'sensitive' | 'all';
/** El asker resuelve true=aprobar, false=denegar. Lo provee la superficie (WebChat/CLI). */
export type ConsentAsker = (promptText: string) => Promise<boolean>;

let _asker: ConsentAsker | null = null;

/** La superficie (server.ts / CLI) registra aquí cómo preguntar al usuario. */
export function setBrowserConsentAsker(fn: ConsentAsker | null): void {
  _asker = fn;
}

function mode(): ConsentMode {
  const m = (process.env.KAGE_CONSENT || 'off').toLowerCase();
  if (m === 'sensitive' || m === 'all') return m;
  return 'off';
}

/**
 * ¿Esta acción es sensible? Campos password/pago, submits (click sobre submit),
 * navegación a host nuevo y descargas. `targetRef` es el elemento sobre el que
 * se actúa, si se conoce (para leer su flag `sensitive`).
 */
export function isSensitive(cmd: ActCommand, targetRef?: ElementRef, knownHosts?: Set<string>): { sensitive: boolean; reason: string } {
  if (cmd.action === 'type' && targetRef?.sensitive) {
    return { sensitive: true, reason: 'escritura en un campo sensible (contraseña/pago)' };
  }
  if (cmd.action === 'click' && (targetRef?.hint === 'submit' || /entrar|login|iniciar sesi|pagar|comprar|enviar|publicar|delete|borrar|eliminar/i.test(targetRef?.label || ''))) {
    return { sensitive: true, reason: `acción de envío/crítica: "${targetRef?.label ?? ''}"` };
  }
  if (cmd.action === 'navigate' && cmd.url) {
    try {
      const host = new URL(cmd.url).host;
      if (knownHosts && !knownHosts.has(host)) {
        return { sensitive: true, reason: `navegación a un host no visto antes: ${host}` };
      }
    } catch { /* url inválida — la maneja el actor */ }
  }
  return { sensitive: false, reason: '' };
}

/**
 * Decide si una acción puede proceder. Devuelve true=proceder, false=denegada.
 * - mode 'off'        → siempre true.
 * - mode 'sensitive'  → pregunta solo si isSensitive.
 * - mode 'all'        → pregunta siempre.
 * Sin asker registrado: si tocaba preguntar, DENIEGA (fail-safe). Si no tocaba,
 * procede.
 */
export async function requestBrowserConsent(
  cmd: ActCommand,
  targetRef?: ElementRef,
  knownHosts?: Set<string>,
): Promise<{ allowed: boolean; reason: string }> {
  const m = mode();
  if (m === 'off') return { allowed: true, reason: 'consent off' };

  const sens = isSensitive(cmd, targetRef, knownHosts);
  const mustAsk = m === 'all' || sens.sensitive;
  if (!mustAsk) return { allowed: true, reason: 'no sensible' };

  if (!_asker) {
    return { allowed: false, reason: `denegado: ${sens.reason || 'requiere consentimiento'} y no hay UI para preguntar (KAGE_CONSENT=${m})` };
  }

  const timeoutMs = Number(process.env.KAGE_CONSENT_TIMEOUT_MS) || 60_000;
  const promptText =
    `🌐 Shinobi quiere ejecutar una acción de navegador que requiere tu permiso:\n` +
    `   • Acción: ${cmd.action}${targetRef ? ` sobre "${targetRef.label}"` : ''}${cmd.url ? ` (${cmd.url})` : ''}\n` +
    `   • Motivo: ${sens.reason || 'política KAGE_CONSENT=all'}\n` +
    `¿Apruebas? (si no respondes en ${Math.round(timeoutMs / 1000)}s se DENIEGA)`;

  let settled = false;
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => { if (!settled) resolve(false); }, timeoutMs),
  );

  let answer: boolean;
  try {
    answer = await Promise.race([_asker(promptText), timeout]);
  } catch {
    answer = false; // error al preguntar → fail-safe deny
  }
  settled = true;

  return answer
    ? { allowed: true, reason: 'aprobado por el usuario' }
    : { allowed: false, reason: `denegado/timeout: ${sens.reason}` };
}

/**
 * F1.3 (auditoría 2026-07, RANK #4 — bypass trivial de un control existente).
 *
 * Antes, el consentimiento de navegación (`requestBrowserConsent`) solo se
 * invocaba desde `browser_act.ts`/`browser_session.ts` (subsistema Kage).
 * `web_search.ts`, `web_search_with_warmup.ts` y `clean_extract.ts` navegan
 * vía un cliente CDP distinto (`browser_cdp.ts::connectOrLaunchCDP`, no
 * `KageSession`) sin pasar por NINGÚN gate — un agente que quisiera evitar
 * el consentimiento simplemente usaba una de esas tres tools en vez de
 * `browser_act` para llegar al mismo sitio.
 *
 * `requestNavigationConsent()` centraliza el gate para esa familia de tools:
 * misma función `requestBrowserConsent()`, mismo set de `knownHosts`
 * COMPARTIDO con `KageSession` (así que "host nuevo en esta sesión" es
 * consistente sin importar qué tool navegó primero — `browser_act` a
 * `github.com` y luego `web_search` a `github.com` no vuelve a preguntar).
 * `rememberNavigatedHost()` se llama tras una navegación exitosa para
 * mantener ese estado compartido al día.
 */
export async function requestNavigationConsent(url: string): Promise<{ allowed: boolean; reason: string }> {
  const { kageSession } = await import('./session.js');
  return requestBrowserConsent({ action: 'navigate', url }, undefined, kageSession().knownHosts);
}

/** Registra `url` como host conocido en el mismo set compartido que usa
 *  `KageSession.rememberHost()` — para tools que no pasan por KageSession
 *  (web_search, clean_extract, ...) pero sí navegan vía connectOrLaunchCDP. */
export async function rememberNavigatedHost(url: string): Promise<void> {
  try {
    const host = new URL(url).host;
    if (!host) return;
    const { kageSession } = await import('./session.js');
    kageSession().knownHosts.add(host);
  } catch { /* url no parseable — no hay host que recordar */ }
}
