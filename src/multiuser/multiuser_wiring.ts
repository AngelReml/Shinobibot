/**
 * Cableado multiuser (P2). El UserRegistry estaba construido pero ningún
 * canal resolvía usuarios contra él. Ahora el gateway HTTP resuelve el
 * usuario de cada request (cabecera `X-Shinobi-User`) contra el registry,
 * dándolo de alta on-first-contact y registrando su actividad.
 */

import { join } from 'path';
import { UserRegistry, isValidUserId, type UserRecord } from './user_registry.js';

let _registry: UserRegistry | null = null;

/** Singleton del registry de usuarios (rooted en <cwd>/users). */
export function userRegistry(): UserRegistry {
  if (!_registry) {
    _registry = new UserRegistry(process.env.SHINOBI_USERS_ROOT || join(process.cwd(), 'users'));
    // Bootstrap del owner si el registry está vacío.
    if (_registry.list().length === 0) {
      try { _registry.create({ userId: 'owner', displayName: 'Owner', role: 'owner' }); } catch { /* ya existe */ }
    }
  }
  return _registry;
}

/**
 * Resuelve el usuario de una petición a partir de la cabecera `X-Shinobi-User`.
 *
 * SEGURIDAD: esa cabecera NO está autenticada — cualquier caller que ya pasó
 * el token del gateway podría declararse otro usuario. Por eso solo se
 * confía si el operador lo habilita con `SHINOBI_TRUST_USER_HEADER=1` (caso:
 * gateway detrás de un proxy de identidad que fija la cabecera). Por defecto
 * la cabecera se ignora y todo se atribuye al owner — sin aislamiento falso.
 *
 * Incluso con la cabecera habilitada, solo puede crear/seleccionar usuarios
 * `guest` o reusar una cuenta `family` ya dada de alta por el operador: un
 * header que apunte a una cuenta `owner`/`collaborator` existente NO concede
 * ese rol (cae al owner). `family` SÍ es seleccionable — es un rol RESTRINGIDO
 * (caja cerrada via familyApprovalGate), no uno privilegiado; bloquearlo aquí
 * dejaría el modo familia inalcanzable por cualquier canal (bug, no diseño:
 * `createFamily` no tendría ningún caller que pudiera activar sus
 * restricciones).
 */
export function resolveUser(userId?: string, displayName?: string): UserRecord {
  const reg = userRegistry();
  const owner = (): UserRecord => {
    const o = reg.get(reg.ownerId() || 'owner') ?? reg.list()[0];
    reg.touchActive(o.userId);
    return o;
  };
  if (process.env.SHINOBI_TRUST_USER_HEADER !== '1') return owner();

  const id = (userId || '').trim().toLowerCase();
  if (id && isValidUserId(id)) {
    let rec = reg.get(id);
    // Un header no puede escalar a una cuenta PRIVILEGIADA existente
    // (owner/collaborator). `family` es restringido, no privilegiado — se
    // deja pasar para que sus restricciones puedan aplicarse de verdad.
    if (rec && rec.role !== 'guest' && rec.role !== 'family') return owner();
    if (!rec) {
      // ALTA-25 (auditoría 2026-07-01): sin cap, cada `X-Shinobi-User` único
      // creaba un guest nuevo sin límite (entrada en users.json + directorio
      // en disco) — DoS por agotamiento de disco / degradación de
      // `list()` O(N). Con el cap alcanzado, la petición se atiende como
      // guest EFÍMERO (no persiste en el registry ni crea directorio) en vez
      // de crear uno más — sigue funcionando, solo pierde continuidad de
      // identidad entre peticiones.
      const maxGuests = Number(process.env.SHINOBI_MAX_GUESTS) || 50;
      const guestCount = reg.list().filter((u) => u.role === 'guest').length;
      if (guestCount >= maxGuests) {
        console.warn(`[multiuser] límite de guests (${maxGuests}) alcanzado — "${id}" se atiende como guest efímero, sin alta en el registry.`);
        return {
          userId: id,
          displayName: displayName || id,
          role: 'guest',
          createdAt: new Date().toISOString(),
          userDir: EPHEMERAL_GUEST_DIR,
        };
      }
      rec = reg.create({ userId: id, displayName: displayName || id, role: 'guest' });
    }
    reg.touchActive(id);
    return rec;
  }
  return owner();
}

/**
 * Directorio placeholder para guests efímeros (ALTA-25, cap alcanzado) — NO
 * se crea en disco automáticamente; cualquier operación de escritura real
 * bajo este path fallaría de forma segura (fail-closed) en vez de escribir
 * silenciosamente en un directorio compartido/inesperado.
 */
const EPHEMERAL_GUEST_DIR = join(process.env.SHINOBI_USERS_ROOT || join(process.cwd(), 'users'), '_overflow_ephemeral');

/** Test helper: reinicia el singleton. */
export function _resetMultiuserWiring(): void { _registry = null; }

// ── Modo familia: enforcement de restricciones de caja ───────────────────────

const SHELL_TOOLS = new Set(['run_command', 'spawn_agent', 'task_scheduler_create']);
const DESTRUCTIVE_TOOLS_FAMILY = new Set([
  'run_command',         // shell + posible rm
  'task_scheduler_create', // crea tarea persistente
  'start_cloud_mission', // compute remoto
  'n8n_invoke',          // workflow externo
]);

/**
 * Construye un approvalGate listo para inyectar en AgentLoopOptions que
 * enforcea las restricciones de un usuario de familia.
 *
 * Si el usuario no tiene restricciones (owner/collaborator/guest sin
 * FamilyRestrictions), devuelve null — no hay gate extra.
 */
export function familyApprovalGate(userId: string): ((tool: string, args: any) => Promise<boolean>) | null {
  const reg = userRegistry();
  const user = reg.get(userId);
  if (!user?.restrictions) return null;
  const r = user.restrictions;

  return async (tool: string, args: any): Promise<boolean> => {
    if (r.noShell && SHELL_TOOLS.has(tool)) {
      return false; // caja: sin shell
    }
    if (r.noDestructive && DESTRUCTIVE_TOOLS_FAMILY.has(tool)) {
      return false; // caja: sin destructivo
    }
    if (r.noCriticalPaths && (tool === 'write_file' || tool === 'edit_file')) {
      const p = typeof args?.path === 'string' ? args.path : '';
      // MEDIA-08 (auditoría 2026-07-01): la regex original solo cubría `.env`
      // EXACTO (no `.env.local`/`.env.production`/`.env.staging`) y
      // `authorized_keys` exacto (no `authorized_keys2`). Un usuario family
      // con noCriticalPaths podía escribir esas variantes libremente.
      const SENSITIVE = /(^|[\\/])(\.env(\.[a-z0-9_-]+)?|\.ssh[\\/]|\.bashrc|\.profile|\.zshrc|authorized_keys[0-9]*)|(\.pem|\.key|\.crt|\.p12|\.pfx)$/i;
      if (SENSITIVE.test(p)) return false; // caja: sin rutas críticas
    }
    return true;
  };
}

/**
 * Devuelve el presupuesto de iteraciones para un usuario.
 * 0 significa sin límite. Para owner/collaborator/guest siempre 0.
 */
export function userIterationBudget(userId: string): number {
  const reg = userRegistry();
  const user = reg.get(userId);
  return user?.restrictions?.maxIterationsPerSession ?? 0;
}
