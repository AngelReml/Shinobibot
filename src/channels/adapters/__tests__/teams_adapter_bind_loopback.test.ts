// F2.4 (auditoría 2026-07) — teams_adapter.ts debe bindear a 127.0.0.1 por
// defecto (paridad con webhook_adapter.ts), exponerse a otras interfaces
// (0.0.0.0) SOLO con configuración explícita (TEAMS_LISTEN_HOST).
//
// `botbuilder` no está instalado en este entorno de test (dependencia
// opcional, ver el resto de tests de TeamsAdapter en
// src/channels/__tests__/new_adapters.test.ts que confirman
// `start()` lanza "botbuilder no está instalado" antes de llegar a
// `server.listen()`). Por eso este test verifica el contrato de dos formas
// complementarias:
//   1. Estático: el código fuente pasa un host explícito a `.listen(port, host)`
//      y ese host por defecto es '127.0.0.1' (no un `.listen(port)` desnudo,
//      que en Node bindea a todas las interfaces).
//   2. La lógica de resolución de host (`process.env.TEAMS_LISTEN_HOST ||
//      '127.0.0.1'`) es la misma que usaría el adapter — se reproduce aquí
//      para no depender de mockear botbuilder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_SRC_PATH = join(__dirname, '..', 'teams_adapter.ts');

function resolveTeamsListenHost(): string {
  return process.env.TEAMS_LISTEN_HOST || '127.0.0.1';
}

describe('F2.4 — TeamsAdapter bindea a loopback por defecto', () => {
  let prevHost: string | undefined;

  beforeEach(() => { prevHost = process.env.TEAMS_LISTEN_HOST; delete process.env.TEAMS_LISTEN_HOST; });
  afterEach(() => { if (prevHost === undefined) delete process.env.TEAMS_LISTEN_HOST; else process.env.TEAMS_LISTEN_HOST = prevHost; });

  it('sin TEAMS_LISTEN_HOST, el host por defecto es 127.0.0.1 (no 0.0.0.0)', () => {
    expect(resolveTeamsListenHost()).toBe('127.0.0.1');
  });

  it('con TEAMS_LISTEN_HOST=0.0.0.0 explícito, se respeta el override (opt-in)', () => {
    process.env.TEAMS_LISTEN_HOST = '0.0.0.0';
    expect(resolveTeamsListenHost()).toBe('0.0.0.0');
  });

  it('el código fuente llama a server.listen(port, host) — nunca listen(port) desnudo', () => {
    const src = readFileSync(ADAPTER_SRC_PATH, 'utf-8');
    // No debe quedar ningún `.listen(port)` sin segundo argumento de host
    // (eso bindearía a 0.0.0.0 por defecto en Node).
    expect(src).not.toMatch(/\.listen\(port\)\s*;/);
    expect(src).toMatch(/\.listen\(port,\s*host\)/);
  });

  it('el código fuente resuelve host con fallback literal a 127.0.0.1', () => {
    const src = readFileSync(ADAPTER_SRC_PATH, 'utf-8');
    expect(src).toMatch(/TEAMS_LISTEN_HOST[\s\S]{0,40}'127\.0\.0\.1'/);
  });
});
