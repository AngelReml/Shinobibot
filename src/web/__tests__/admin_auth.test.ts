// Regresión auditoría 2026-07-01:
//   - MEDIA-05: comparación de admin token debe ser timing-safe.
//   - CRIT-14: /api/approval debe exigir SHINOBI_ADMIN_TOKEN cuando el
//     operador lo tiene configurado (defensa en profundidad más allá de CSRF).
// tokensEqual/requireAdminTokenIfConfigured viven a nivel de módulo en
// server.ts (no dentro de startWebServer) precisamente para ser testeables
// sin levantar el servidor completo (WS, orchestrator, etc.)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { tokensEqual, requireAdminTokenIfConfigured } from '../server.js';

describe('tokensEqual — comparación timing-safe (MEDIA-05)', () => {
  it('true cuando coinciden exactamente', () => {
    expect(tokensEqual('secreto-123', 'secreto-123')).toBe(true);
  });
  it('false cuando no coinciden (misma longitud)', () => {
    expect(tokensEqual('secreto-124', 'secreto-123')).toBe(false);
  });
  it('false cuando difieren en longitud (no lanza)', () => {
    expect(() => tokensEqual('corto', 'un-secreto-mucho-mas-largo')).not.toThrow();
    expect(tokensEqual('corto', 'un-secreto-mucho-mas-largo')).toBe(false);
  });
  it('false cuando el valor recibido no es string (headers ausentes/array)', () => {
    expect(tokensEqual(undefined, 'x')).toBe(false);
    expect(tokensEqual(['a', 'b'], 'x')).toBe(false);
    expect(tokensEqual('', 'x')).toBe(false);
  });
});

describe('requireAdminTokenIfConfigured — CRIT-14', () => {
  afterEach(() => {
    delete process.env.SHINOBI_ADMIN_TOKEN;
  });

  function mockRes() {
    const res: any = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  }

  it('sin SHINOBI_ADMIN_TOKEN configurado, deja pasar (preserva comportamiento actual single-user)', () => {
    delete process.env.SHINOBI_ADMIN_TOKEN;
    const next = vi.fn();
    const req: any = { headers: {} };
    requireAdminTokenIfConfigured(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('con SHINOBI_ADMIN_TOKEN configurado y header ausente, deniega 401', () => {
    process.env.SHINOBI_ADMIN_TOKEN = 'top-secret-admin-token';
    const next = vi.fn();
    const req: any = { headers: {} };
    const res = mockRes();
    requireAdminTokenIfConfigured(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('con SHINOBI_ADMIN_TOKEN configurado y header incorrecto, deniega 401', () => {
    process.env.SHINOBI_ADMIN_TOKEN = 'top-secret-admin-token';
    const next = vi.fn();
    const req: any = { headers: { 'x-admin-token': 'adivinado' } };
    const res = mockRes();
    requireAdminTokenIfConfigured(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('con SHINOBI_ADMIN_TOKEN configurado y header correcto, deja pasar', () => {
    process.env.SHINOBI_ADMIN_TOKEN = 'top-secret-admin-token';
    const next = vi.fn();
    const req: any = { headers: { 'x-admin-token': 'top-secret-admin-token' } };
    const res = mockRes();
    requireAdminTokenIfConfigured(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
