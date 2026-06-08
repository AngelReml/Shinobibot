// src/channels/pairing.ts
//
// CAPA DE CONFIANZA de canales — pairing + identidad firmada.
//
// Sin esto, un mensaje de cualquier usuario de un canal abierto (Discord/Slack/
// Telegram…) pilota el agente completo (run_command, ficheros…). Esta gate sienta
// una autorización entre el mensaje entrante y el orchestrator:
//
//   - mode 'open'      → sin gate (default; cero cambio para back-compat).
//   - mode 'code'      → un remitente debe enviar el código de emparejamiento
//                         (SHINOBI_PAIRING_CODE) una vez; queda emparejado.
//   - mode 'allowlist' → solo identidades en SHINOBI_CHANNEL_ALLOWLIST.
//   - mode 'closed'    → nadie (canal silenciado).
//
// El modo se AUTO-detecta: si hay código o allowlist configurados, se activa la
// gate; si no, queda 'open'. El operador puede forzar con SHINOBI_PAIRING_MODE.
//
// Identidad FIRMADA: cada identidad emparejada (channel:userId) se firma con HMAC
// (SHINOBI_PAIRING_SECRET). El store persiste la firma; al cargar, una entrada
// con firma inválida (paired.json manipulado a mano) se descarta. Da una
// identidad estable y no falsificable sin el secreto.

import { createHmac } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve, join } from 'path';

export type PairingMode = 'open' | 'code' | 'allowlist' | 'closed';

/** Clave de identidad estable de un remitente. */
export function identityKey(channelId: string, userId?: string): string {
  return `${channelId}:${userId ?? 'anon'}`;
}

function secret(): string {
  return process.env.SHINOBI_PAIRING_SECRET || 'shinobi-default-pairing-secret';
}

/** Firma HMAC-SHA256 (truncada) de una identidad. */
export function signIdentity(key: string): string {
  return createHmac('sha256', secret()).update(key).digest('hex').slice(0, 32);
}

/** Modo de pairing efectivo (auto-detectado de la config). */
export function pairingMode(): PairingMode {
  const forced = (process.env.SHINOBI_PAIRING_MODE || '').toLowerCase();
  if (forced === 'open' || forced === 'code' || forced === 'allowlist' || forced === 'closed') return forced;
  if (process.env.SHINOBI_PAIRING_CODE) return 'code';
  if (process.env.SHINOBI_CHANNEL_ALLOWLIST) return 'allowlist';
  return 'open';
}

function allowlist(): Set<string> {
  return new Set((process.env.SHINOBI_CHANNEL_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean));
}

interface PairedEntry { key: string; signature: string; pairedAt: string; }

export class PairingStore {
  private readonly path: string;
  private paired = new Map<string, PairedEntry>();
  private loaded = false;

  constructor(path?: string) {
    this.path = path ? resolve(path) : (process.env.SHINOBI_PAIRING_PATH
      ? resolve(process.env.SHINOBI_PAIRING_PATH)
      : join(process.cwd(), '.shinobi', 'paired.json'));
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf-8'));
      const entries: PairedEntry[] = Array.isArray(raw?.paired) ? raw.paired : [];
      for (const e of entries) {
        // Identidad firmada: descarta entradas manipuladas (firma inválida).
        if (e && typeof e.key === 'string' && e.signature === signIdentity(e.key)) {
          this.paired.set(e.key, e);
        }
      }
    } catch { /* fichero corrupto → store vacío */ }
  }

  private save(): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.path, JSON.stringify({ paired: [...this.paired.values()] }, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }

  isPaired(key: string): boolean {
    this.load();
    return this.paired.has(key);
  }

  pair(key: string): PairedEntry {
    this.load();
    const entry: PairedEntry = { key, signature: signIdentity(key), pairedAt: new Date().toISOString() };
    this.paired.set(key, entry);
    this.save();
    return entry;
  }

  unpair(key: string): boolean {
    this.load();
    const had = this.paired.delete(key);
    if (had) this.save();
    return had;
  }

  list(): PairedEntry[] {
    this.load();
    return [...this.paired.values()];
  }
}

let _store: PairingStore | null = null;
export function pairingStore(): PairingStore {
  if (!_store) _store = new PairingStore();
  return _store;
}
/** Solo para tests: descarta el singleton (y opcionalmente fija un path). */
export function _resetPairingStore(path?: string): void {
  _store = path ? new PairingStore(path) : null;
}

export interface AuthDecision {
  allowed: boolean;
  /** Respuesta a enviar al remitente en vez de procesar (challenge/bienvenida/rechazo). */
  reply?: string;
  /** true si este mensaje completó un emparejamiento. */
  paired?: boolean;
}

/**
 * Decide si un mensaje entrante puede llegar al orchestrator. No procesa nada;
 * solo autoriza. Maneja el emparejamiento por código in-band.
 */
export function authorizeIncoming(
  channelId: string,
  userId: string | undefined,
  text: string,
  store: PairingStore = pairingStore(),
): AuthDecision {
  const mode = pairingMode();
  if (mode === 'open') return { allowed: true };

  const key = identityKey(channelId, userId);
  if (mode === 'closed') return { allowed: false, reply: 'Este canal está silenciado.' };

  // Ya autorizado (allowlist o emparejado previamente).
  if (allowlist().has(key) || store.isPaired(key)) return { allowed: true };

  if (mode === 'allowlist') {
    return { allowed: false, reply: 'No estás autorizado en este canal.' };
  }

  // mode 'code': el primer mensaje que coincida con el código empareja.
  const code = process.env.SHINOBI_PAIRING_CODE || '';
  if (code && text.trim() === code) {
    store.pair(key);
    return { allowed: false, paired: true, reply: '✅ Emparejado. Ya puedes hablar conmigo; envía tu petición.' };
  }
  return {
    allowed: false,
    reply: 'Para usar este agente necesitas emparejarte: envía el código de emparejamiento que te dio el operador.',
  };
}
