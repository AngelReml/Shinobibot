// Probes de capacidad para tests que dependen de una feature del SO real.
//
// El problema: la suite corre en Windows (`ci.yml`), pero el runner
// `windows-latest` de GitHub es una cuenta de servicio sin sesión interactiva —
// DPAPI `CurrentUser` no tiene clave utilizable, y `powershell.exe` en frío
// tarda más que el `testTimeout` de vitest. En una máquina Windows real de
// desarrollo, las dos cosas funcionan.
//
// En vez de `process.platform === 'win32' ? it : it.skip` (que en CI-Windows
// deja los tests corriendo y reventando), estos probes comprueban la capacidad
// DE VERDAD, una sola vez, y los tests se saltan con un motivo visible cuando
// el entorno no puede ejecutarlos. Mismo patrón que
// `src/browser/__tests__/_playwright_available.ts`.

import { execFileSync } from 'node:child_process';
import { dpapiProtect, dpapiUnprotect } from '../attest/dpapi.js';

function probeDpapi(): { usable: boolean; reason: string } {
  if (process.platform !== 'win32') {
    return { usable: false, reason: `DPAPI solo existe en Windows (process.platform=${process.platform}).` };
  }
  try {
    const sample = Buffer.from('probe').toString('base64');
    const enc = dpapiProtect(sample);
    if (enc && dpapiUnprotect(enc) === sample) return { usable: true, reason: '' };
  } catch { /* cae al mensaje de abajo */ }
  return {
    usable: false,
    reason:
      'DPAPI CurrentUser no operativo en este entorno (cuenta de servicio / runner de CI ' +
      'sin credencial interactiva). Ejecuta estos tests en una sesión Windows real.',
  };
}

function probePowershell(): { usable: boolean; reason: string } {
  if (process.platform !== 'win32') {
    return { usable: false, reason: `powershell.exe solo existe en Windows (process.platform=${process.platform}).` };
  }
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '1'], {
      timeout: 8000,
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (out.trim() === '1') return { usable: true, reason: '' };
  } catch { /* cae al mensaje de abajo */ }
  return {
    usable: false,
    reason:
      'powershell.exe no respondió en 8 s (arranque en frío en un runner de CI). ' +
      'Ejecuta estos tests en una máquina Windows real.',
  };
}

const _dpapi = probeDpapi();
const _pwsh = _dpapi.usable ? { usable: true, reason: '' } : probePowershell();

export const dpapiUsable: boolean = _dpapi.usable;
export const dpapiSkipReason: string = _dpapi.reason;

/** true si `powershell.exe` responde a tiempo (implica win32). Si DPAPI ya probó ok, se da por bueno. */
export const powershellUsable: boolean = _pwsh.usable;
export const powershellSkipReason: string = _pwsh.reason;
