// src/browser/consent.ts
// Mejora 5: consentimiento específico del navegador, INDEPENDIENTE del gate
// global (que está desactivado por FIX-002). Política propia: ante acciones
// sensibles se pregunta, y si no hay respuesta a tiempo se DENIEGA (lo contrario
// al gate global, que aprueba por timeout). Ver docs/BROWSER_SUBSYSTEM.md §1.5.

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
  const m = (process.env.KAGE_CONSENT || 'sensitive').toLowerCase();
  if (m === 'off' || m === 'all') return m;
  return 'sensitive';
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
