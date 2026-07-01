// F2.4 (auditoría 2026-07) — el default de pairing pasa de 'open' a
// 'closed'. Sin NINGUNA configuración (SHINOBI_PAIRING_MODE/CODE/ALLOWLIST
// ausentes), un canal recién conectado debe quedar silenciado hasta que el
// operador empareje explícitamente. 'open' sigue disponible pero SOLO como
// opt-in explícito.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pairingMode, authorizeIncoming } from '../pairing.js';

const PAIRING_ENVS = ['SHINOBI_PAIRING_MODE', 'SHINOBI_PAIRING_CODE', 'SHINOBI_CHANNEL_ALLOWLIST', 'SHINOBI_PAIRING_SECRET'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const e of PAIRING_ENVS) { saved[e] = process.env[e]; delete process.env[e]; }
  process.env.SHINOBI_PAIRING_SECRET = 'test-secret';
});
afterEach(() => {
  for (const e of PAIRING_ENVS) { if (saved[e] === undefined) delete process.env[e]; else process.env[e] = saved[e]; }
});

describe('F2.4 — pairing default is closed, not open', () => {
  it('pairingMode() sin configuración devuelve "closed" (no "open")', () => {
    expect(pairingMode()).toBe('closed');
  });

  it('un mensaje entrante sin ninguna config queda DENEGADO (silenciado)', () => {
    const decision = authorizeIncoming('discord', 'random-user', 'ejecuta rm -rf /');
    expect(decision.allowed).toBe(false);
    expect(decision.reply).toMatch(/silenciado/i);
  });

  it('"open" sigue existiendo pero requiere opt-in explícito (SHINOBI_PAIRING_MODE=open)', () => {
    process.env.SHINOBI_PAIRING_MODE = 'open';
    expect(pairingMode()).toBe('open');
    expect(authorizeIncoming('discord', 'random-user', 'hola').allowed).toBe(true);
  });

  it('configurar código sigue auto-activando modo "code" (no rompe el flujo de emparejamiento)', () => {
    process.env.SHINOBI_PAIRING_CODE = 'XYZ123';
    expect(pairingMode()).toBe('code');
  });

  it('configurar allowlist sigue auto-activando modo "allowlist"', () => {
    process.env.SHINOBI_CHANNEL_ALLOWLIST = 'discord:trusted';
    expect(pairingMode()).toBe('allowlist');
  });

  it('forzar SHINOBI_PAIRING_MODE=closed explícitamente sigue funcionando (idempotente con el nuevo default)', () => {
    process.env.SHINOBI_PAIRING_MODE = 'closed';
    expect(pairingMode()).toBe('closed');
    expect(authorizeIncoming('slack', 'u', 'hi').allowed).toBe(false);
  });
});
