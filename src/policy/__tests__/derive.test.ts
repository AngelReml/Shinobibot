import { describe, it, expect } from 'vitest';
import { deriveMandateFromEffects, proposeMandateFromExecuted, mandateCoversAll } from '../derive.js';
import type { SimEffect } from '../dryrun.js';
import type { ExecutedEffect } from '../../sandbox/mandate.js';

describe('deriveMandateFromEffects', () => {
  it('dedup + cubre todo lo observado', () => {
    const eff: SimEffect[] = [
      { kind: 'shell', scope: '/ws' }, { kind: 'net', scope: 'api.x.com' }, { kind: 'shell', scope: '/ws' },
    ];
    const m = deriveMandateFromEffects(eff);
    expect(m.capabilities).toEqual(['net:api.x.com', 'shell:/ws']);
    expect(mandateCoversAll(m, eff)).toBe(true);
  });

  it('colapsa el descendiente si el ANCESTRO también se observó', () => {
    const eff: SimEffect[] = [{ kind: 'fs.read', scope: '/ws' }, { kind: 'fs.read', scope: '/ws/sub' }];
    const m = deriveMandateFromEffects(eff);
    expect(m.capabilities).toEqual(['fs.read:/ws']);
    expect(mandateCoversAll(m, eff)).toBe(true);
  });

  it('NO inventa un padre no observado: hermanos se conservan ambos', () => {
    const eff: SimEffect[] = [{ kind: 'fs.read', scope: '/ws/a' }, { kind: 'fs.read', scope: '/ws/b' }];
    const m = deriveMandateFromEffects(eff);
    expect(m.capabilities).toEqual(['fs.read:/ws/a', 'fs.read:/ws/b']);
    expect(mandateCoversAll(m, eff)).toBe(true);
  });

  it('minimalidad: quitar cualquier capacidad deja algún efecto sin cubrir', () => {
    const eff: SimEffect[] = [{ kind: 'fs.read', scope: '/ws/a' }, { kind: 'net', scope: 'api.x.com' }];
    const m = deriveMandateFromEffects(eff);
    for (const cap of m.capabilities) {
      const reduced = { capabilities: m.capabilities.filter((c) => c !== cap) };
      expect(mandateCoversAll(reduced, eff)).toBe(false);
    }
  });

  it('vacío ⇒ deny-all (sin capacidades)', () => {
    expect(deriveMandateFromEffects([]).capabilities).toEqual([]);
  });

  it('determinista: el orden de entrada no cambia la salida', () => {
    const a = deriveMandateFromEffects([{ kind: 'net', scope: 'b' }, { kind: 'net', scope: 'a' }]);
    const b = deriveMandateFromEffects([{ kind: 'net', scope: 'a' }, { kind: 'net', scope: 'b' }]);
    expect(a.capabilities).toEqual(b.capabilities);
  });

  it('ttlMs>0 fija caducidad', () => {
    const m = deriveMandateFromEffects([{ kind: 'shell', scope: '/ws' }], { ttlMs: 1000, now: 5000 });
    expect(m.expiresAt).toBe(6000);
  });
});

describe('proposeMandateFromExecuted', () => {
  it('descarta los efectos DENEGADOS (no ocurrieron) y deriva de los permitidos', () => {
    const eff: ExecutedEffect[] = [
      { kind: 'net', scope: 'api.x.com', decision: 'allow' },
      { kind: 'net', scope: 'evil.com', decision: 'deny' },   // no debe entrar en la propuesta
      { kind: 'shell', scope: '/ws', decision: 'allow' },
    ];
    const m = proposeMandateFromExecuted(eff);
    expect(m.capabilities).toEqual(['net:api.x.com', 'shell:/ws']);
  });

  it('todos denegados ⇒ propuesta vacía (deny-all)', () => {
    const eff: ExecutedEffect[] = [{ kind: 'net', scope: 'evil.com', decision: 'deny' }];
    expect(proposeMandateFromExecuted(eff).capabilities).toEqual([]);
  });
});
