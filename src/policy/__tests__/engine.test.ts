// P4 — tests del motor de policy. Mutación canónica: resolveMandate que ignora el
// perfil (siempre default) → el caso "perfil conocido -> sus caps" se pone rojo.
// Verificado por el protocolo de la regla #2 (evidencia en DECISIONES.md).
import { describe, it, expect } from 'vitest';
import { resolveMandate, loadPolicy, resolveMissionMandate, DENY_ALL_POLICY } from '../engine.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const policy = { default: ['shell:/ws'], profiles: { net: ['net:api.x.com'] }, ttlMs: 1000 };

describe('P4 — resolveMandate', () => {
  it('sin perfil ⇒ default; ttl ⇒ expiresAt', () => {
    const m = resolveMandate(policy, {}, 5000);
    expect(m.capabilities).toEqual(['shell:/ws']);
    expect(m.expiresAt).toBe(6000);
  });
  it('perfil conocido ⇒ sus caps; desconocido ⇒ default (fail-closed)', () => {
    expect(resolveMandate(policy, { profile: 'net' }).capabilities).toEqual(['net:api.x.com']);
    expect(resolveMandate(policy, { profile: 'zzz' }).capabilities).toEqual(['shell:/ws']);
  });
  it('DENY_ALL ⇒ mandato vacío', () => {
    expect(resolveMandate(DENY_ALL_POLICY).capabilities).toEqual([]);
  });
});

describe('P4 — loadPolicy fail-closed', () => {
  it('JSON válido se carga; basura/inexistente ⇒ DENY_ALL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pol_'));
    const good = join(dir, 'p.json'); writeFileSync(good, JSON.stringify({ default: ['shell:*'] }));
    expect(loadPolicy(good).default).toEqual(['shell:*']);
    const bad = join(dir, 'bad.json'); writeFileSync(bad, '{no-json');
    expect(loadPolicy(bad)).toBe(DENY_ALL_POLICY);
    expect(loadPolicy(join(dir, 'nope.json'))).toBe(DENY_ALL_POLICY);
  });
});

describe('P4 — resolveMissionMandate (precedencia policy > env > legado)', () => {
  it('sin policy ni SHINOBI_MANDATE ⇒ undefined (default-off)', () => {
    delete process.env.SHINOBI_POLICY; delete process.env.SHINOBI_MANDATE;
    expect(resolveMissionMandate()).toBeUndefined();
  });
  it('SHINOBI_MANDATE sin policy ⇒ ese mandato', () => {
    delete process.env.SHINOBI_POLICY;
    process.env.SHINOBI_MANDATE = 'shell:*';
    try { expect(resolveMissionMandate()?.capabilities).toEqual(['shell:*']); }
    finally { delete process.env.SHINOBI_MANDATE; }
  });
});
