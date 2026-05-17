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
 * `guest`: un header que apunte a una cuenta `owner`/`collaborator` existente
 * NO concede ese rol (cae al owner).
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
    // Un header no puede escalar a una cuenta privilegiada existente.
    if (rec && rec.role !== 'guest') return owner();
    if (!rec) rec = reg.create({ userId: id, displayName: displayName || id, role: 'guest' });
    reg.touchActive(id);
    return rec;
  }
  return owner();
}

/** Test helper: reinicia el singleton. */
export function _resetMultiuserWiring(): void { _registry = null; }
