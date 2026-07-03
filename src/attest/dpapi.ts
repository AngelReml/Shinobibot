// P2.E3.c (plan de frontera 2026-07-01) — cifrado en reposo de la identidad de
// dispositivo vía DPAPI (Windows Data Protection API).
//
// `device_identity.ts` persistía la privada Ed25519 en JSON 0600 EN CLARO (seam
// documentado en ese fichero). Este módulo la envuelve con
// `System.Security.Cryptography.ProtectedData` (scope `CurrentUser`) — el mismo
// primitivo que usan Credential Manager y `ConvertTo-SecureString` internamente.
// Solo el usuario de Windows que la cifró, en la misma máquina, puede desenvolverla
// (la clave de cifrado la deriva el SO a partir de las credenciales del usuario;
// no vive en ningún fichero de este repo).
//
// No hay binding nativo de Node para DPAPI en las dependencias del repo (regla:
// no se añade un paquete nativo nuevo solo para esto). Se invoca vía
// `powershell.exe -EncodedCommand` (mismo patrón que `src/tools/_powershell.ts`):
// el script viaja como base64 UTF-16LE, cero interpolación de shell.
//
// FAIL-SOFT por diseño: fuera de win32 (Linux CI, contenedores, WSL sin
// powershell.exe) o si el binding falla por cualquier razón, ambas funciones
// devuelven `null`. El caller (`device_identity.ts`) cae al fichero en claro con
// un WARNING — nunca lanza, nunca rompe el arranque multiusuario/CI.

import { execFileSync } from 'child_process';
import { buildSafeChildEnv } from '../sandbox/backends/local.js';

const TIMEOUT_MS = 15_000;

// Los payloads que entran aquí son SIEMPRE `Buffer.toString('base64')` generados
// por este mismo proceso — pero se valida el charset igualmente (defensa en
// profundidad: si algún día un caller pasa algo no confiable, nunca se interpola
// texto arbitrario dentro del script de PowerShell).
const BASE64_RE = /^[A-Za-z0-9+/]*=*$/;

function runProtectedDataScript(body: string): string | null {
  if (process.platform !== 'win32') return null;
  const script = `$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.Security\n${body}`;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: TIMEOUT_MS, encoding: 'utf-8', windowsHide: true, env: buildSafeChildEnv() },
    );
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** true si esta plataforma puede, en principio, soportar DPAPI (solo win32). No garantiza que la llamada real funcione. */
export function dpapiPlatformSupported(): boolean {
  return process.platform === 'win32';
}

/**
 * Cifra `plainBase64` (bytes ya codificados en base64 por el caller) con DPAPI,
 * scope `CurrentUser`. Devuelve el blob cifrado, también en base64, o `null` si
 * DPAPI no está disponible o la llamada falla.
 */
export function dpapiProtect(plainBase64: string): string | null {
  if (!BASE64_RE.test(plainBase64)) return null;
  return runProtectedDataScript(
    `$bytes = [Convert]::FromBase64String('${plainBase64}')\n` +
      `$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)\n` +
      `[Convert]::ToBase64String($protected)`,
  );
}

/**
 * Desenvuelve un blob producido por `dpapiProtect` de vuelta a base64 plano.
 * `null` si DPAPI no está disponible, el blob no es de este usuario/máquina, o
 * la llamada falla por cualquier razón.
 */
export function dpapiUnprotect(protectedBase64: string): string | null {
  if (!BASE64_RE.test(protectedBase64)) return null;
  return runProtectedDataScript(
    `$bytes = [Convert]::FromBase64String('${protectedBase64}')\n` +
      `$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)\n` +
      `[Convert]::ToBase64String($plain)`,
  );
}
