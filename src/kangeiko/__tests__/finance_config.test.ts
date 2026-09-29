import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFinanceConfig, LiveTradingUnavailableError } from '../domains/finance/config.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('finance F0 — flags', () => {
  it('sin variables de entorno: finanzas apagadas y live apagado', () => {
    expect(readFinanceConfig({})).toEqual({ financeEnabled: false, liveTrading: false });
  });

  it('FINANCE_ENABLED activa el dominio, pero live sigue apagado', () => {
    expect(readFinanceConfig({ FINANCE_ENABLED: '1' })).toEqual({ financeEnabled: true, liveTrading: false });
    expect(readFinanceConfig({ FINANCE_ENABLED: 'true', LIVE_TRADING: 'false' })).toEqual({ financeEnabled: true, liveTrading: false });
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' live '])('LIVE_TRADING=%j se rechaza: no existe ruta a trading real', (value) => {
    expect(() => readFinanceConfig({ FINANCE_ENABLED: '1', LIVE_TRADING: value })).toThrow(LiveTradingUnavailableError);
  });

  it.each(['', '0', 'false', 'off', 'no'])('LIVE_TRADING=%j se acepta como apagado', (value) => {
    expect(readFinanceConfig({ LIVE_TRADING: value }).liveTrading).toBe(false);
  });
});

describe('finance F0 — arranca sin credenciales ni acceso a broker', () => {
  it('importar el dominio y operar con fixtures no hace ninguna llamada de red', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('red prohibida en el dominio financiero F0');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const finance = await import('../domains/finance/index.js');
    expect(finance.readFinanceConfig({}).liveTrading).toBe(false);
    const r = finance.checkOrderPreconditions({
      strategy_id: 'sma_cross',
      instrument: 'BTC-USD-PERP',
      snapshot: finance.loadFinanceFixture('market_snapshot_verified'),
      mandate: finance.loadFinanceFixture('strategy_mandate_conservative'),
      now: '2026-01-15T12:00:01.000Z',
    });
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('el código del dominio no importa clientes de red ni lee credenciales', async () => {
    const fs = await import('fs');
    const { fileURLToPath } = await import('url');
    const dir = fileURLToPath(new URL('../domains/finance/', import.meta.url));
    const sources = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(dir + f, 'utf-8')).join('\n');
    expect(sources).not.toMatch(/from '(https?|net|tls|undici|ws|axios|node-fetch)'/);
    expect(sources).not.toMatch(/\bfetch\(/);
    expect(sources).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/);
  });
});
