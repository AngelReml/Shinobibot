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
 * Resuelve el usuario de una petición. Si el userId es válido y no existe,
 * lo da de alta como `guest` (on-first-contact). Si falta o es inválido,
 * cae al owner. Registra actividad. Devuelve el UserRecord.
 */
export function resolveUser(userId?: string, displayName?: string): UserRecord {
  const reg = userRegistry();
  const id = (userId || '').trim().toLowerCase();
  if (id && isValidUserId(id)) {
    let rec = reg.get(id);
    if (!rec) rec = reg.create({ userId: id, displayName: displayName || id, role: 'guest' });
    reg.touchActive(id);
    return rec;
  }
  const owner = reg.get(reg.ownerId() || 'owner') ?? reg.list()[0];
  reg.touchActive(owner.userId);
  return owner;
}

/** Test helper: reinicia el singleton. */
export function _resetMultiuserWiring(): void { _registry = null; }
