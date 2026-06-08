// src/channels/__tests__/pairing.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  identityKey,
  signIdentity,
  pairingMode,
  PairingStore,
  authorizeIncoming,
} from '../pairing.js';

const PAIRING_ENVS = ['SHINOBI_PAIRING_MODE', 'SHINOBI_PAIRING_CODE', 'SHINOBI_CHANNEL_ALLOWLIST', 'SHINOBI_PAIRING_SECRET', 'SHINOBI_PAIRING_PATH'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const e of PAIRING_ENVS) { saved[e] = process.env[e]; delete process.env[e]; }
  process.env.SHINOBI_PAIRING_SECRET = 'test-secret';
});
afterEach(() => {
  for (const e of PAIRING_ENVS) { if (saved[e] === undefined) delete process.env[e]; else process.env[e] = saved[e]; }
});

function tmpStore(): { store: PairingStore; path: string } {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pair-')), 'paired.json');
  return { store: new PairingStore(p), path: p };
}

describe('identidad firmada', () => {
  it('identityKey y signIdentity son deterministas', () => {
    expect(identityKey('discord', 'u1')).toBe('discord:u1');
    expect(identityKey('slack')).toBe('slack:anon');
    expect(signIdentity('discord:u1')).toBe(signIdentity('discord:u1'));
    expect(signIdentity('discord:u1')).toHaveLength(32);
  });
  it('la firma cambia con el secreto', () => {
    const a = signIdentity('k');
    process.env.SHINOBI_PAIRING_SECRET = 'otro';
    expect(signIdentity('k')).not.toBe(a);
  });
});

describe('pairingMode', () => {
  it('open por defecto; auto-detecta code/allowlist; forzable', () => {
    expect(pairingMode()).toBe('open');
    process.env.SHINOBI_PAIRING_CODE = '1234';
    expect(pairingMode()).toBe('code');
    delete process.env.SHINOBI_PAIRING_CODE;
    process.env.SHINOBI_CHANNEL_ALLOWLIST = 'discord:u1';
    expect(pairingMode()).toBe('allowlist');
    process.env.SHINOBI_PAIRING_MODE = 'closed';
    expect(pairingMode()).toBe('closed');
  });
});

describe('PairingStore', () => {
  it('pair/isPaired/unpair y persistencia entre instancias', () => {
    const { store, path: p } = tmpStore();
    expect(store.isPaired('discord:u1')).toBe(false);
    store.pair('discord:u1');
    expect(store.isPaired('discord:u1')).toBe(true);
    // nueva instancia desde el mismo fichero ve el emparejamiento
    expect(new PairingStore(p).isPaired('discord:u1')).toBe(true);
    expect(store.unpair('discord:u1')).toBe(true);
    expect(new PairingStore(p).isPaired('discord:u1')).toBe(false);
  });

  it('descarta entradas con firma inválida (paired.json manipulado)', () => {
    const { store, path: p } = tmpStore();
    store.pair('discord:legit');
    // Manipulación: añade una identidad sin firma válida.
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    raw.paired.push({ key: 'discord:evil', signature: 'firma-falsa', pairedAt: 'x' });
    fs.writeFileSync(p, JSON.stringify(raw));
    const reloaded = new PairingStore(p);
    expect(reloaded.isPaired('discord:legit')).toBe(true);
    expect(reloaded.isPaired('discord:evil')).toBe(false); // rechazada por firma
  });
});

describe('authorizeIncoming', () => {
  it('open → siempre permitido', () => {
    expect(authorizeIncoming('discord', 'u', 'hola').allowed).toBe(true);
  });

  it('closed → denegado con aviso', () => {
    process.env.SHINOBI_PAIRING_MODE = 'closed';
    const d = authorizeIncoming('discord', 'u', 'hola');
    expect(d.allowed).toBe(false);
    expect(d.reply).toMatch(/silenciado/i);
  });

  it('allowlist → solo identidades de la lista', () => {
    process.env.SHINOBI_CHANNEL_ALLOWLIST = 'discord:ok';
    expect(authorizeIncoming('discord', 'ok', 'hi').allowed).toBe(true);
    expect(authorizeIncoming('discord', 'malo', 'hi').allowed).toBe(false);
  });

  it('code → empareja con el código y luego permite', () => {
    process.env.SHINOBI_PAIRING_CODE = 'SECRETO';
    const { store } = tmpStore();
    // sin código → challenge
    const a = authorizeIncoming('discord', 'u1', 'hola', store);
    expect(a.allowed).toBe(false);
    expect(a.reply).toMatch(/emparejar/i);
    // con el código → empareja (no procesa el mensaje del código)
    const b = authorizeIncoming('discord', 'u1', 'SECRETO', store);
    expect(b.allowed).toBe(false);
    expect(b.paired).toBe(true);
    // siguiente mensaje → permitido
    expect(authorizeIncoming('discord', 'u1', 'haz algo', store).allowed).toBe(true);
    // otro usuario sigue sin estar emparejado
    expect(authorizeIncoming('discord', 'u2', 'haz algo', store).allowed).toBe(false);
  });
});
