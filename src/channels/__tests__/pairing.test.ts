// src/channels/__tests__/pairing.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHmac } from 'crypto';
import {
  identityKey,
  signIdentity,
  pairingMode,
  PairingStore,
  authorizeIncoming,
  _resetGeneratedSecretCache,
} from '../pairing.js';

const PAIRING_ENVS = ['SHINOBI_PAIRING_MODE', 'SHINOBI_PAIRING_CODE', 'SHINOBI_CHANNEL_ALLOWLIST', 'SHINOBI_PAIRING_SECRET', 'SHINOBI_PAIRING_PATH', 'SHINOBI_PAIRING_SECRET_PATH'];
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

// Regresion ALTA-24 (auditoria 2026-07-01): sin SHINOBI_PAIRING_SECRET, antes
// se usaba el literal publico 'shinobi-default-pairing-secret' - cualquiera
// que leyera el codigo fuente podia forjar firmas validas. Ahora se genera
// un secreto aleatorio y se persiste para ser estable entre reinicios.
describe('secreto generado cuando SHINOBI_PAIRING_SECRET no esta configurado (ALTA-24)', () => {
  it('nunca usa el literal publico hardcodeado', () => {
    delete process.env.SHINOBI_PAIRING_SECRET;
    process.env.SHINOBI_PAIRING_SECRET_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pairsecret-')), 'secret');
    _resetGeneratedSecretCache();
    const sigWithDefault = createHmac('sha256', 'shinobi-default-pairing-secret').update('k').digest('hex').slice(0, 32);
    expect(signIdentity('k')).not.toBe(sigWithDefault);
  });

  it('el secreto generado es estable entre "reinicios" (persistido en disco)', () => {
    delete process.env.SHINOBI_PAIRING_SECRET;
    process.env.SHINOBI_PAIRING_SECRET_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pairsecret-')), 'secret');
    _resetGeneratedSecretCache();
    const sig1 = signIdentity('estable');
    _resetGeneratedSecretCache(); // simula un "reinicio" del proceso (cache en memoria perdida)
    const sig2 = signIdentity('estable');
    expect(sig2).toBe(sig1); // el fichero persistido da el MISMO secreto
  });

  it('instalaciones distintas (paths distintos) obtienen secretos distintos', () => {
    delete process.env.SHINOBI_PAIRING_SECRET;
    process.env.SHINOBI_PAIRING_SECRET_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pairsecret-a-')), 'secret');
    _resetGeneratedSecretCache();
    const sigA = signIdentity('k');

    process.env.SHINOBI_PAIRING_SECRET_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-pairsecret-b-')), 'secret');
    _resetGeneratedSecretCache();
    const sigB = signIdentity('k');

    expect(sigA).not.toBe(sigB);
  });
});

describe('pairingMode', () => {
  // F2.4 (auditoria 2026-07): el default sin configuracion paso de 'open' a
  // 'closed' - 'open' sin gate nunca debe ser lo que se obtiene "por no
  // hacer nada" en un canal de mensajeria real. Sigue auto-detectando
  // code/allowlist, y sigue siendo forzable por env (incluido 'open' como
  // opt-in explicito para desarrollo).
  it('closed por defecto; auto-detecta code/allowlist; forzable (incluido open como opt-in)', () => {
    expect(pairingMode()).toBe('closed');
    process.env.SHINOBI_PAIRING_CODE = '1234';
    expect(pairingMode()).toBe('code');
    delete process.env.SHINOBI_PAIRING_CODE;
    process.env.SHINOBI_CHANNEL_ALLOWLIST = 'discord:u1';
    expect(pairingMode()).toBe('allowlist');
    delete process.env.SHINOBI_CHANNEL_ALLOWLIST;
    process.env.SHINOBI_PAIRING_MODE = 'closed';
    expect(pairingMode()).toBe('closed');
    process.env.SHINOBI_PAIRING_MODE = 'open';
    expect(pairingMode()).toBe('open');
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

  it('descarta entradas con firma invalida (paired.json manipulado)', () => {
    const { store, path: p } = tmpStore();
    store.pair('discord:legit');
    // Manipulacion: anade una identidad sin firma valida.
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    raw.paired.push({ key: 'discord:evil', signature: 'firma-falsa', pairedAt: 'x' });
    fs.writeFileSync(p, JSON.stringify(raw));
    const reloaded = new PairingStore(p);
    expect(reloaded.isPaired('discord:legit')).toBe(true);
    expect(reloaded.isPaired('discord:evil')).toBe(false); // rechazada por firma
  });
});

describe('authorizeIncoming', () => {
  it('open (opt-in explicito) -> siempre permitido', () => {
    process.env.SHINOBI_PAIRING_MODE = 'open';
    expect(authorizeIncoming('discord', 'u', 'hola').allowed).toBe(true);
  });

  it('closed -> denegado con aviso', () => {
    process.env.SHINOBI_PAIRING_MODE = 'closed';
    const d = authorizeIncoming('discord', 'u', 'hola');
    expect(d.allowed).toBe(false);
    expect(d.reply).toMatch(/silenciado/i);
  });

  // F2.4: sin NINGUNA configuracion, el default ya no es 'open' - es
  // 'closed'. Un canal recien conectado sin codigo/allowlist queda
  // silenciado hasta que el operador lo configure explicitamente.
  it('closed por defecto (sin configuracion) -> denegado con aviso de silenciado', () => {
    const d = authorizeIncoming('discord', 'u', 'hola');
    expect(d.allowed).toBe(false);
    expect(d.reply).toMatch(/silenciado/i);
  });

  it('allowlist -> solo identidades de la lista', () => {
    process.env.SHINOBI_CHANNEL_ALLOWLIST = 'discord:ok';
    expect(authorizeIncoming('discord', 'ok', 'hi').allowed).toBe(true);
    expect(authorizeIncoming('discord', 'malo', 'hi').allowed).toBe(false);
  });

  it('code -> empareja con el codigo y luego permite', () => {
    process.env.SHINOBI_PAIRING_CODE = 'SECRETO';
    const { store } = tmpStore();
    // sin codigo -> challenge
    const a = authorizeIncoming('discord', 'u1', 'hola', store);
    expect(a.allowed).toBe(false);
    expect(a.reply).toMatch(/emparejar/i);
    // con el codigo -> empareja (no procesa el mensaje del codigo)
    const b = authorizeIncoming('discord', 'u1', 'SECRETO', store);
    expect(b.allowed).toBe(false);
    expect(b.paired).toBe(true);
    // siguiente mensaje -> permitido
    expect(authorizeIncoming('discord', 'u1', 'haz algo', store).allowed).toBe(true);
    // otro usuario sigue sin estar emparejado
    expect(authorizeIncoming('discord', 'u2', 'haz algo', store).allowed).toBe(false);
  });
});
