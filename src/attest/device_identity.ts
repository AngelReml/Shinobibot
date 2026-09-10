// P1.E3.c / P2.E1 — Identidad de dispositivo Ed25519.
//
// Shinobi firma sus mandatos (y, más adelante, sus Recibos de Misión — P2) con un
// par Ed25519 PROPIO de esta instalación: la "identidad de dispositivo". La pública
// es el carné con el que un tercero verifica; la privada nunca sale de la máquina,
// nunca se audita, nunca entra en el backup (respeta F6.2). Reutiliza la primitiva
// Ed25519 ya presente en el repo (`agents/provenance_v2.ts::generateProvenanceKeypair`)
// — no reinventa cripto (regla del plan de frontera §P2).
//
// P2.E3.c (este corte): en Windows, la privada se envuelve con DPAPI
// (`./dpapi.ts`, scope `CurrentUser`) antes de tocar disco — el JSON persistido
// contiene `privateKeyEnc` (blob cifrado), NUNCA `privateKeyPem` en claro. Fuera de
// win32, o si DPAPI falla por cualquier razón (fail-soft, nunca lanza), cae al
// formato legado: JSON 0600 con `privateKeyPem` en claro + un WARNING — así CI/Linux
// y multiusuario sin DPAPI siguen arrancando. Los ficheros ya existentes en formato
// legado se siguen leyendo sin migración forzosa (la pública no cambia de formato).
// La pública SIEMPRE queda en claro (es pública por diseño).

import { generateProvenanceKeypair, type ProvenanceKeypair } from '../agents/provenance_v2.js';
import { dpapiPlatformSupported, dpapiProtect, dpapiUnprotect } from './dpapi.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';

export type DeviceIdentity = ProvenanceKeypair; // { publicKeyPem, privateKeyPem }

interface DeviceKeyFileDpapi {
  publicKeyPem: string;
  privateKeyEnc: string;
  dpapi: true;
}
interface DeviceKeyFileLegacy {
  publicKeyPem: string;
  privateKeyPem: string;
}
type DeviceKeyFile = DeviceKeyFileDpapi | DeviceKeyFileLegacy;

function defaultKeyPath(): string {
  if (process.env.SHINOBI_DEVICE_KEY_PATH) return resolve(process.env.SHINOBI_DEVICE_KEY_PATH);
  return join(process.cwd(), '.shinobi', 'device_key.json');
}

let _cached: DeviceIdentity | null = null;

/** Lee `path` y devuelve la identidad si el fichero es válido (DPAPI o legado en claro). `null` si no aplica. */
function tryLoad(path: string): DeviceIdentity | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DeviceKeyFile> | null;
  if (!raw || typeof raw.publicKeyPem !== 'string') return null;

  if ((raw as DeviceKeyFileDpapi).dpapi === true && typeof (raw as DeviceKeyFileDpapi).privateKeyEnc === 'string') {
    const plainB64 = dpapiUnprotect((raw as DeviceKeyFileDpapi).privateKeyEnc);
    if (!plainB64) return null; // blob de otro usuario/máquina, o DPAPI caído → no se reutiliza una clave dudosa
    const privateKeyPem = Buffer.from(plainB64, 'base64').toString('utf-8');
    return { publicKeyPem: raw.publicKeyPem, privateKeyPem };
  }

  if (typeof (raw as DeviceKeyFileLegacy).privateKeyPem === 'string') {
    return { publicKeyPem: raw.publicKeyPem, privateKeyPem: (raw as DeviceKeyFileLegacy).privateKeyPem };
  }

  return null;
}

/** Persiste `kp` en `path`: DPAPI si está disponible y funciona, legado en claro si no (con WARNING). */
function persist(path: string, kp: DeviceIdentity): void {
  mkdirSync(dirname(path), { recursive: true });

  // SHINOBI_DEVICE_KEY_NO_DPAPI=1 → salta DPAPI y usa el formato legado. Para
  // CI / contenedores / arranques headless donde DPAPI no aporta (cuenta de
  // servicio sin credencial interactiva) o solo añade el coste de un
  // powershell.exe en frío. El caller sigue funcionando igual (misma identidad).
  if (process.env.SHINOBI_DEVICE_KEY_NO_DPAPI !== '1' && dpapiPlatformSupported()) {
    const plainB64 = Buffer.from(kp.privateKeyPem, 'utf-8').toString('base64');
    const encB64 = dpapiProtect(plainB64);
    if (encB64) {
      const payload: DeviceKeyFileDpapi = { publicKeyPem: kp.publicKeyPem, privateKeyEnc: encB64, dpapi: true };
      writeFileSync(path, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 });
      return;
    }
    console.warn(
      '[device_identity] DPAPI disponible por plataforma pero la llamada falló: la clave privada se ' +
        'persiste en claro (permisos 0600) como fallback. Ver DECISIONES.md P2.E3.c.',
    );
  }

  const payload: DeviceKeyFileLegacy = { publicKeyPem: kp.publicKeyPem, privateKeyPem: kp.privateKeyPem };
  writeFileSync(path, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Carga la identidad de dispositivo, o la CREA la primera vez (par Ed25519 nuevo).
 * Cacheada en proceso. `path` inyectable para test. Fail-soft: si no se puede
 * persistir, la identidad vive en memoria durante este proceso (no lanza).
 */
export function getDeviceIdentity(path: string = defaultKeyPath()): DeviceIdentity {
  if (_cached) return _cached;
  try {
    const loaded = tryLoad(path);
    if (loaded) {
      _cached = loaded;
      return _cached;
    }
  } catch {
    /* fichero corrupto/inaccesible → se regenera abajo (no se reutiliza una clave dudosa) */
  }
  const kp = generateProvenanceKeypair();
  try {
    persist(path, kp);
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
