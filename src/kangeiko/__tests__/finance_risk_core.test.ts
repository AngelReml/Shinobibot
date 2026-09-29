import { describe, it, expect } from 'vitest';
import {
  evaluateRisk,
  loadFinanceFixture,
  mandateFieldsAboveCaps,
  validateMarketSnapshot,
  validateRiskCaps,
  validateStrategyMandate,
  CAPPED_FIELDS,
  type MarketSnapshot,
  type OrderIntent,
  type PortfolioState,
  type RiskCaps,
  type RiskResult,
  type StrategyMandate,
} from '../domains/finance/index.js';

const snap = (() => {
  const s = validateMarketSnapshot(loadFinanceFixture('market_snapshot_verified'));
  if (!s.ok) throw new Error('fixture inválido');
  return s.value;
})();
const baseMandate = (() => {
  const m = validateStrategyMandate(loadFinanceFixture('strategy_mandate_conservative'));
  if (!m.ok) throw new Error('fixture inválido');
  return m.value;
})();

// Mandato holgado: sirve para medir el valor real de cada métrica antes de fijar el límite en él.
const loose: StrategyMandate = {
  ...baseMandate,
  max_position_notional: 1e9, max_loss_per_trade: 1e9, max_loss_per_day: 1e9, max_loss_per_cycle: 1e9,
  max_gross_exposure: 1e9, max_net_exposure: 1e9, max_open_positions: 100, max_drawdown: 0.99,
  max_orders_per_day: 1000, max_slippage_bps: 1000, max_depth_fraction: 1,
  factors: [{ factor: 'crypto_beta', instruments: ['BTC-USD-PERP', 'ETH-USD-PERP'], max_exposure: 1e9 }],
};

const intent = (over: Partial<OrderIntent> = {}): OrderIntent => ({
  intent_id: 'i-1', seq: 1, strategy_id: 'sma_cross', strategy_version: '1.0.0', instrument: 'BTC-USD-PERP',
  side: 'buy', quantity: 0.01, limit_price: null, stop_price: 41600, expected_slippage_bps: 1,
  created_at: '2026-01-15T12:00:01.000Z', hypothesis: 'h', signal: { name: 's', value: 1 }, probability: null, ...over,
});

const state = (over: Partial<PortfolioState> = {}): PortfolioState => ({
  equity: 10_000, peak_equity: 10_000, realized_pnl_day: 0, realized_pnl_cycle: 0, positions: {}, ...over,
});

const run = (m: Partial<StrategyMandate> = {}, i: Partial<OrderIntent> = {}, s: Partial<PortfolioState> = {}, orders = 0, sn: MarketSnapshot = snap): RiskResult =>
  evaluateRisk(intent(i), sn, { ...loose, ...m }, state(s), orders);

function measure(key: string, i: Partial<OrderIntent> = {}, s: Partial<PortfolioState> = {}): number {
  const r = run({}, i, s);
  if (!r.ok) throw new Error(`la medición no debía fallar: ${r.code}`);
  return Math.abs(r.evidence[key] as number);
}

function expectBoundary(field: keyof StrategyMandate, observed: number, code: string, i: Partial<OrderIntent> = {}, s: Partial<PortfolioState> = {}) {
  expect(run({ [field]: observed * (1 + 1e-6) }, i, s).ok).toBe(true);
  expect(run({ [field]: observed }, i, s).ok).toBe(true);
  const over = run({ [field]: observed * (1 - 1e-6) }, i, s);
  expect(over.ok).toBe(false);
  if (!over.ok) {
    expect(over.code).toBe(code);
    expect(over.decision).toBe('rejected');
    expect(over.tripKillSwitch).toBe(false);
  }
}

describe('finance F1 — RiskCore: cada límite justo por debajo, en el límite y justo por encima', () => {
  it('pérdida máxima por trade', () => expectBoundary('max_loss_per_trade', measure('worst_loss'), 'MAX_LOSS_PER_TRADE'));

  it('pérdida del día suma la pérdida ya realizada', () => {
    const s = { realized_pnl_day: -12 };
    expectBoundary('max_loss_per_day', 12 + measure('worst_loss', {}, s), 'MAX_LOSS_PER_DAY', {}, s);
  });

  it('pérdida del ciclo suma la pérdida ya realizada', () => {
    const s = { realized_pnl_cycle: -40 };
    expectBoundary('max_loss_per_cycle', 40 + measure('worst_loss', {}, s), 'MAX_LOSS_PER_CYCLE', {}, s);
  });

  it('un día con beneficio no amplía el presupuesto de pérdida', () => {
    const worst = measure('worst_loss');
    expect(run({ max_loss_per_day: worst * (1 - 1e-6) }, {}, { realized_pnl_day: 500 }).ok).toBe(false);
  });

  it('posición por instrumento', () => expectBoundary('max_position_notional', measure('position_after'), 'MAX_POSITION'));

  it('exposición bruta con otra posición abierta', () => {
    const s = { positions: { 'ETH-USD-PERP': -300 } };
    expectBoundary('max_gross_exposure', measure('gross_after', {}, s), 'MAX_GROSS_EXPOSURE', {}, s);
  });

  it('exposición neta con otra posición abierta', () => {
    const s = { positions: { 'ETH-USD-PERP': 300 } };
    expectBoundary('max_net_exposure', measure('net_after', {}, s), 'MAX_NET_EXPOSURE', {}, s);
  });

  it('slippage esperado', () => expectBoundary('max_slippage_bps', 1, 'MAX_SLIPPAGE'));

  it('drawdown proyectado por el peor caso', () => {
    const s = { equity: 9_800 };
    const worst = measure('worst_loss', {}, s);
    expectBoundary('max_drawdown', (10_000 - (9_800 - worst)) / 10_000, 'MAX_DRAWDOWN', {}, s);
  });

  it('liquidez: fracción de la profundidad visible del lado que se consume', () => {
    const i = { quantity: 0.49 };
    expect(run({ max_depth_fraction: 0.05 }, i).ok).toBe(true); // 9.8 × 0.05 = 0.49
    const over = run({ max_depth_fraction: 0.049 }, i);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('INSUFFICIENT_LIQUIDITY');
    // Una venta consume el lado bid (12.4), que admite más cantidad.
    expect(run({ max_depth_fraction: 0.049 }, { ...i, side: 'sell', stop_price: 42400 }).ok).toBe(true);
  });

  it('exposición por factor', () => {
    const s = { positions: { 'ETH-USD-PERP': 300 } };
    const observed = measure('net_after', {}, s); // el factor agrupa BTC y ETH: coincide con la neta aquí
    const f = (x: number) => ({ factors: [{ factor: 'crypto_beta', instruments: ['BTC-USD-PERP', 'ETH-USD-PERP'], max_exposure: x }] });
    expect(run(f(observed), {}, s).ok).toBe(true);
    const over = run(f(observed * (1 - 1e-6)), {}, s);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('MAX_FACTOR_EXPOSURE');
  });

  it('número de posiciones abiertas', () => {
    const s = { positions: { 'ETH-USD-PERP': 300 } };
    expect(run({ max_open_positions: 2 }, {}, s).ok).toBe(true);
    const over = run({ max_open_positions: 1 }, {}, s);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('MAX_OPEN_POSITIONS');
    // Ampliar una posición existente no abre otra.
    expect(run({ max_open_positions: 1 }, {}, { positions: { 'BTC-USD-PERP': 100 } }).ok).toBe(true);
  });

  it('número de órdenes del día', () => {
    expect(run({ max_orders_per_day: 3 }, {}, {}, 2).ok).toBe(true);
    const over = run({ max_orders_per_day: 3 }, {}, {}, 3);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('MAX_ORDERS_PER_DAY');
  });
});

describe('finance F1 — RiskCore: datos incompletos y drawdown agotado', () => {
  it('sin bid/ask o sin profundidad se bloquea, no se rechaza', () => {
    const noQuote = run({}, {}, {}, 0, { ...snap, bid: null });
    expect(noQuote).toMatchObject({ ok: false, decision: 'blocked', code: 'NO_QUOTE' });
    const noDepth = run({}, {}, {}, 0, { ...snap, depth: null });
    expect(noDepth).toMatchObject({ ok: false, decision: 'blocked', code: 'NO_LIQUIDITY_DATA' });
  });

  it('un stop que no protege se rechaza', () => {
    expect(run({}, { stop_price: 42001.5 })).toMatchObject({ ok: false, code: 'INVALID_STOP' });
    expect(run({}, { side: 'sell', stop_price: 42000.5 })).toMatchObject({ ok: false, code: 'INVALID_STOP' });
  });

  it('una orden a mercado entra al ask si compra y al bid si vende', () => {
    expect(measure('entry_price')).toBe(42001.5);
    expect(measure('entry_price', { side: 'sell', stop_price: 42400 })).toBe(42000.5);
    expect(measure('entry_price', { limit_price: 41900, stop_price: 41500 })).toBe(41900);
  });

  it('drawdown actual en el límite: se bloquea y pide enclavar el kill switch; justo antes, no', () => {
    const at = run({ max_drawdown: 0.05 }, {}, { equity: 9_500 });
    expect(at).toMatchObject({ ok: false, decision: 'blocked', code: 'MAX_DRAWDOWN', tripKillSwitch: true });
    const before = run({ max_drawdown: 0.05 }, { quantity: 0.001 }, { equity: 9_501 });
    expect(before.ok || !before.tripKillSwitch).toBe(true);
  });

  it('el drawdown agotado se detecta aunque el intent fallara por otra causa', () => {
    expect(run({ max_drawdown: 0.05 }, { stop_price: 50_000 }, { equity: 9_000 })).toMatchObject({ code: 'MAX_DRAWDOWN', tripKillSwitch: true });
  });
});

describe('finance F1 — techo del core', () => {
  const caps = Object.fromEntries(CAPPED_FIELDS.map((k) => [k, k === 'max_drawdown' || k === 'max_depth_fraction' ? 1 : 1e12])) as RiskCaps;

  it('valida que el techo tenga todos los campos, positivos y con fracciones ≤ 1', () => {
    expect(validateRiskCaps(caps).ok).toBe(true);
    const r = validateRiskCaps({ ...caps, max_drawdown: 1.5, max_loss_per_trade: 0, max_open_positions: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['max_drawdown', 'max_loss_per_trade', 'max_open_positions']));
  });

  it('lista cada campo del mandato que supera el techo, incluidos los factores', () => {
    const tight = { ...caps, max_loss_per_trade: 5, max_net_exposure: 1000 };
    expect(mandateFieldsAboveCaps(baseMandate, tight).sort()).toEqual(['factors.crypto_beta', 'max_loss_per_trade', 'max_net_exposure']);
    expect(mandateFieldsAboveCaps(baseMandate, caps)).toEqual([]);
  });
});
