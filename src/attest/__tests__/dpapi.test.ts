// P2.E3.c — DPAPI (Windows) roundtrip. Corre real contra powershell.exe (sin mocks:
// es la única forma honesta de verificar que CryptProtectData/Unprotect funcionan
// de verdad en esta máquina). En no-win32 se salta (DPAPI no existe fuera de Windows).
import { describe, it, expect } from 'vitest';
import { dpapiPlatformSupported, dpapiProtect, dpapiUnprotect } from '../dpapi.js';

const itWin = process.platform === 'win32' ? it : it.skip;

describe('P2.E3.c — dpapiPlatformSupported', () => {
  it('refleja el platform real', () => {
    expect(dpapiPlatformSupported()).toBe(process.platform === 'win32');
  });
});

describe('P2.E3.c — dpapiProtect/dpapiUnprotect (win32)', () => {
  itWin('roundtrip: protect → unprotect recupera el texto original', () => {
    const plain = Buffer.from('shinobi-device-key-material-üñí', 'utf-8').toString('base64');
    const enc = dpapiProtect(plain);
    expect(enc).not.toBeNull();
    expect(enc).not.toBe(plain); // el blob cifrado no es el texto plano
    const dec = dpapiUnprotect(enc as string);
    expect(dec).toBe(plain);
  });

  itWin('el blob cifrado nunca contiene el texto plano como substring', () => {
    const secret = 'MUY-SECRETO-1234567890';
    const plain = Buffer.from(secret, 'utf-8').toString('base64');
    const enc = dpapiProtect(plain) as string;
    expect(enc).not.toContain(secret);
    expect(enc).not.toContain(plain);
  });

  itWin('input no-base64 se rechaza sin llamar a PowerShell (null)', () => {
    expect(dpapiProtect('no es base64 válido; $(rm -rf /)')).toBeNull();
    expect(dpapiUnprotect('tampoco; & calc.exe')).toBeNull();
  });

  itWin('unprotect de basura (no es un blob DPAPI real) devuelve null, no lanza', () => {
    const garbage = Buffer.from('esto no es un blob DPAPI').toString('base64');
    expect(dpapiUnprotect(garbage)).toBeNull();
  });
});

describe('P2.E3.c — fail-soft fuera de win32', () => {
  it('en plataformas no-win32, dpapiProtect/Unprotect devuelven null sin lanzar', () => {
    if (process.platform === 'win32') return; // esta rama solo aplica fuera de Windows
    expect(dpapiProtect('aGVsbG8=')).toBeNull();
    expect(dpapiUnprotect('aGVsbG8=')).toBeNull();
  });
});
