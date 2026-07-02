// P1.E3.c / P2.E1 (parcial) — Identidad de dispositivo Ed25519.
//
// Shinobi firma sus mandatos (y, más adelante, sus Recibos de Misión — P2) con un
// par Ed25519 PROPIO de esta instalación: la "identidad de dispositivo". La pública
// es el carné con el que un tercero verifica; la privada nunca sale de la máquina,
// nunca se audita, nunca entra en el backup (respeta F6.2). Reutiliza la primitiva
// Ed25519 ya presente en el repo (`agents/provenance_v2.ts::generateProvenanceKeypair`)
// — no reinventa cripto (regla del plan de frontera §P2).
//
// ALCANCE HONESTO: este backend persiste la clave en un JSON en disco con permisos
// 0600. En Windows, el endurecimiento correcto es cifrar la privada EN REPOSO con
// DPAPI (Credential Manager) — es el P2.E1 completo, y este fichero es el seam sobre
// el que DPAPI se enchufa (misma interfaz, distinto almacenamiento). El backend de
// fichero funciona en cualquier plataforma y es verificable aquí; DPAPI queda
// documentado como pendiente, no fingido.

import { generateProvenanceKeypair, type ProvenanceKeypair } from '../agents/provenance_v2.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';

export type DeviceIdentity = ProvenanceKeypair; // { publicKeyPem, privateKeyPem }

function defaultKeyPath(): string {
  if (process.env.SHINOBI_DEVICE_KEY_PATH) return resolve(process.env.SHINOBI_DEVICE_KEY_PATH);
  return join(process.cwd(), '.shinobi', 'device_key.json');
}

let _cached: DeviceIdentity | null = null;

/**
 * Carga la identidad de dispositivo, o la CREA la primera vez (par Ed25519 nuevo).
 * Cacheada en proceso. `path` inyectable para test. Fail-soft: si no se puede
 * persistir, la identidad vive en memoria durante este proceso (no lanza).
 */
export function getDeviceIdentity(path: string = defaultKeyPath()): DeviceIdentity {
  if (_cached) return _cached;
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      if (raw && typeof raw.publicKeyPem === 'string' && typeof raw.privateKeyPem === 'string') {
        _cached = { publicKeyPem: raw.publicKeyPem, privateKeyPem: raw.privateKeyPem };
        return _cached;
      }
    }
  } catch {
    /* fichero corrupto/inaccesible → se regenera abajo (no se reutiliza una clave dudosa) */
  }
  const kp = generateProvenanceKeypair();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(kp), { encoding: 'utf-8', mode: 0o600 });
  } catch {
    /* best-effort: sin persistencia, la identidad es efímera a este proceso */
  }
  _cached = kp;
  return _cached;
}

/** Solo para tests: olvida la identidad cacheada. */
export function _resetDeviceIdentity(): void {
  _cached = null;
}
