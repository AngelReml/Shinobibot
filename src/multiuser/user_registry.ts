/**
 * Multi-user — un único runtime de Shinobi sirve a varios usuarios con
 * memoria, soul y permisos aislados por user.
 *
 * Modelo:
 *   - userId (slug) es la unidad de aislamiento.
 *   - Cada user tiene `userDir` propio (default `<root>/users/<userId>`)
 *     donde viven USER.md, MEMORY.md, memory.json y opcionalmente
 *     soul.md.
 *   - El registry persiste un fichero `users.json` con metadata y
 *     timestamp de creación.
 *   - role: 'owner' | 'collaborator' | 'guest'. Owner único; los demás
 *     pueden ser revocados.
 *
 * Diferenciador: Hermes y OpenClaw son single-user por diseño. Shinobi
 * en modo VPS sirve a un equipo sin filtraciones cruzadas.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { resolve, join } from 'path';

export type UserRole = 'owner' | 'collaborator' | 'guest';

export interface UserRecord {
  userId: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastActiveAt?: string;
  userDir: string;
  metadata?: Record<string, string>;
}

export interface RegistryState {
  version: 1;
  users: UserRecord[];
  ownerId?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidUserId(id: string): boolean {
  return typeof id === 'string' && SLUG_RE.test(id);
}

export class UserRegistry {
  private readonly stateFile: string;
  private readonly root: string;
  private state: RegistryState;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
    this.stateFile = join(this.root, 'users.json');
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
    this.state = this.load();
  }

  private load(): RegistryState {
    if (!existsSync(this.stateFile)) {
      return { version: 1, users: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf-8')) as RegistryState;
      if (parsed.version !== 1 || !Array.isArray(parsed.users)) {
        return { version: 1, users: [] };
      }
      return parsed;
    } catch {
      return { version: 1, users: [] };
    }
  }

  private save(): void {
    // Escritura atómica: temp + rename. renameSync es atómico dentro del
    // mismo volumen, así que un crash o una escritura concurrente nunca
    // dejan users.json a medias / corrupto.
    const tmp = this.stateFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmp, this.stateFile);
  }

  list(): UserRecord[] {
    return [...this.state.users];
  }

  get(userId: string): UserRecord | null {
    return this.state.users.find(u => u.userId === userId) ?? null;
  }

  ownerId(): string | undefined {
    return this.state.ownerId;
  }

  /**
   * Da de alta un usuario. Si role='owner' y ya hay owner, lanza.
   * Es alta humana — gateada en producción por el operador.
   */
  create(args: {
    userId: string;
    displayName: string;
    role?: UserRole;
    metadata?: Record<string, string>;
  }): UserRecord {
    if (!isValidUserId(args.userId)) {
      throw new Error(`userId inválido: ${args.userId} — debe ser slug [a-z0-9_-]{1,64}`);
    }
    if (this.get(args.userId)) {
      throw new Error(`usuario ya existe: ${args.userId}`);
    }
    const role: UserRole = args.role ?? 'collaborator';
    if (role === 'owner' && this.state.ownerId) {
      throw new Error(`ya existe owner=${this.state.ownerId}; no puede haber dos owners`);
    }

    const userDir = join(this.root, args.userId);
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

    const rec: UserRecord = {
      userId: args.userId,
      displayName: args.displayName,
      role,
      createdAt: new Date().toISOString(),
      userDir,
      metadata: args.metadata,
    };
    this.state.users.push(rec);
    if (role === 'owner') this.state.ownerId = args.userId;
    this.save();
    return rec;
  }

  remove(userId: string): boolean {
    const idx = this.state.users.findIndex(u => u.userId === userId);
    if (idx === -1) return false;
    if (this.state.users[idx].role === 'owner') {
      throw new Error(`no se puede borrar al owner directamente — transfiere ownership primero`);
    }
    this.state.users.splice(idx, 1);
    this.save();
    return true;
  }

  transferOwnership(toUserId: string): UserRecord {
    const target = this.get(toUserId);
    if (!target) throw new Error(`usuario destino no existe: ${toUserId}`);
    const prevOwner = this.state.ownerId ? this.get(this.state.ownerId) : null;
    if (prevOwner) prevOwner.role = 'collaborator';
    target.role = 'owner';
    this.state.ownerId = toUserId;
    this.save();
    return target;
  }

  touchActive(userId: string): void {
    const u = this.get(userId);
    if (!u) return;
    u.lastActiveAt = new Date().toISOString();
    this.save();
  }

  /**
   * Devuelve el path aislado para una pieza de estado por user.
   * Ej: scopedPath('alice', 'memory.json') → <root>/alice/memory.json.
   */
  scopedPath(userId: string, fileName: string): string {
    const u = this.get(userId);
    if (!u) throw new Error(`usuario no existe: ${userId}`);
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error(`fileName inválido: ${fileName}`);
    }
    return join(u.userDir, fileName);
  }

  /**
   * Comprueba si `actor` puede ejecutar `action` sobre `target`.
   * Política:
   *   - owner: todo permitido.
   *   - collaborator: lectura y escritura de su propio scope; lectura
   *     del scope de otros si action='read'; nunca admin.
   *   - guest: solo lectura del propio scope.
   */
  canActOn(actor: string, action: 'read' | 'write' | 'admin', target: string): boolean {
    const a = this.get(actor);
    if (!a) return false;
    if (a.role === 'owner') return true;
    if (action === 'admin') return false;
    if (actor === target) {
      if (a.role === 'guest') return action === 'read';
      return true; // collaborator on self → read/write
    }
    // cross-user
    if (a.role === 'collaborator' && action === 'read') return true;
    return false;
  }
}
