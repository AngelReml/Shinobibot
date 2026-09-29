import { describe, it, expect } from 'vitest';
import {
  canTransition,
  checkOrderPreconditions,
  loadFinanceFixture,
  validateDecisionRecord,
  validateMarketSnapshot,
  validateStrategyMandate,
  type AcceptedDecision,
  type FinanceFixtureName,
} from '../domains/finance/index.js';

const verified = loadFinanceFixture('market_snapshot_verified') as Record<string, unknown>;
const stale = loadFinanceFixture('market_snapshot_stale') as Record<string, unknown>;
const mandate = loadFinanceFixture('strategy_mandate_conservative') as Record<string, unknown>;
const NOW = '2026-01-15T12:00:01.000Z';

const pre = (over: Partial<Parameters<typeof checkOrderPreconditions>[0]> = {}) =>
  checkOrderPreconditions({ strategy_id: 'sma_cross', instrument: 'BTC-USD-PERP', snapshot: verified, mandate, now: NOW, ...over });

describe('finance F0 — fixtures deterministas', () => {
  const names: FinanceFixtureName[] = ['market_snapshot_verified', 'market_snapshot_stale', 'strategy_mandate_conservative', 'decision_record_blocked'];

  it('cada carga produce exactamente los mismos bytes y un objeto nuevo', () => {
    for (const n of names) {
      const a = loadFinanceFixture(n);
      const b = loadFinanceFixture(n);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a).not.toBe(b);
    }
  });

  it('todos los fixtures validan contra su contrato', () => {
    expect(validateMarketSnapshot(verified).ok).toBe(true);
    expect(validateMarketSnapshot(stale).ok).toBe(true);
    expect(validateStrategyMandate(mandate).ok).toBe(true);
    expect(validateDecisionRecord(loadFinanceFixture('decision_record_blocked')).ok).toBe(true);
  });

  it('la decisión bloqueada del fixture coincide con lo que dictan las precondiciones sobre sus entradas', () => {
    const decision = loadFinanceFixture('decision_record_blocked') as { gateway: { code: string } };
    const r = pre({ snapshot: stale });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(decision.gateway.code);
  });
});

describe('finance F0 — validadores fail-closed', () => {
  it('rechaza libro cruzado, mid fuera del spread, hash no hex y calidad desconocida', () => {
    const r = validateMarketSnapshot({ ...verified, bid: 42002, mid: 50000, payload_hash: 'abc', quality: 'fresh' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['crossed_book', 'mid_outside_spread', 'payload_hash', 'quality']));
  });

  it('rechaza schema_version distinta y valores no finitos', () => {
    const r = validateMarketSnapshot({ ...verified, schema_version: 2, bid: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['schema_version', 'bid']));
  });

  it('rechaza mandatos con drawdown fuera de (0,1], límites no positivos o ventana invertida', () => {
    const r = validateStrategyMandate({ ...mandate, max_drawdown: 2, max_loss_per_trade: 0, valid_until: '2025-01-01T00:00:00.000Z' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['max_drawdown', 'max_loss_per_trade', 'validity_window']));
  });

  it('una decisión aceptada sin mandato ni snapshot no valida en runtime', () => {
    const accepted = { ...(loadFinanceFixture('decision_record_blocked') as object), mandate_id: null, snapshot_hash: null, gateway: { decision: 'accepted', code: 'OK', reason: 'ok' } };
    const r = validateDecisionRecord(accepted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['mandate_id', 'snapshot_hash']));
  });

  it('el sistema de tipos impide construir una decisión aceptada sin mandato', () => {
    const acceptedBase: AcceptedDecision = {
      id: 'd', created_at: NOW, schema_version: 1, source: 'test',
      strategy_id: 'sma_cross', strategy_version: '1.0.0', hypothesis: 'h',
      signal: { name: 's', value: 1 }, probability: null,
      snapshot_id: 'snap', snapshot_hash: 'a'.repeat(64), mandate_id: 'm',
      gateway: { decision: 'accepted', code: 'OK', reason: 'ok' },
    };
    // @ts-expect-error una decisión aceptada no admite mandate_id null
    const bad: AcceptedDecision = { ...acceptedBase, mandate_id: null };
    expect(bad.mandate_id).toBeNull();
  });
});

describe('finance F0 — no se abre una orden sin mandato y snapshot válidos', () => {
  it('acepta solo con mandato vigente y snapshot verificado y fresco', () => {
    const r = pre();
    expect(r.ok).toBe(true);
  });

  it.each([
    ['sin mandato', { mandate: null }, 'MISSING_MANDATE'],
    ['mandato inválido', { mandate: { ...mandate, max_drawdown: 2 } }, 'INVALID_MANDATE'],
    ['mandato de otra estrategia', { strategy_id: 'otra' }, 'MANDATE_STRATEGY_MISMATCH'],
    ['mandato caducado', { now: '2026-08-01T00:00:00.000Z' }, 'MANDATE_NOT_ACTIVE'],
    ['sin snapshot', { snapshot: undefined }, 'MISSING_SNAPSHOT'],
    ['snapshot inválido', { snapshot: { ...verified, payload_hash: 'x' } }, 'INVALID_SNAPSHOT'],
    ['snapshot de otro instrumento', { instrument: 'ETH-USD-PERP' }, 'SNAPSHOT_INSTRUMENT_MISMATCH'],
    ['instrumento fuera del universo', { instrument: 'ETH-USD-PERP', snapshot: { ...verified, instrument: 'ETH-USD-PERP' } }, 'INSTRUMENT_OUTSIDE_UNIVERSE'],
    ['snapshot etiquetado stale', { snapshot: stale }, 'SNAPSHOT_QUALITY'],
    ['snapshot synthetic', { snapshot: { ...verified, quality: 'synthetic' } }, 'SNAPSHOT_QUALITY'],
    ['snapshot del futuro', { now: '2026-01-15T11:59:59.000Z' }, 'SNAPSHOT_FROM_FUTURE'],
    ['snapshot verificado pero viejo', { now: '2026-01-15T12:00:06.000Z' }, 'SNAPSHOT_STALE'],
    ['reloj inválido', { now: 'ayer' }, 'INVALID_CLOCK'],
  ] as const)('bloquea: %s', (_label, over, code) => {
    const r = pre(over);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('el límite de antigüedad es inclusivo: justo en el límite pasa, 1 ms después no', () => {
    expect(pre({ now: '2026-01-15T12:00:05.000Z' }).ok).toBe(true);
    const over = pre({ now: '2026-01-15T12:00:05.001Z' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('SNAPSHOT_STALE');
  });
});

describe('finance F0 — estados de estrategia', () => {
  it('ninguna estrategia llega a active sin pasar por certified', () => {
    expect(canTransition('candidate', 'active')).toBe(false);
    expect(canTransition('incubating', 'active')).toBe(false);
    expect(canTransition('certified', 'active')).toBe(true);
  });

  it('una estrategia pausada no se reactiva directamente: vuelve a incubación', () => {
    expect(canTransition('paused', 'active')).toBe(false);
    expect(canTransition('paused', 'incubating')).toBe(true);
  });

  it('retired y rejected son terminales', () => {
    for (const to of ['candidate', 'incubating', 'certified', 'active', 'paused'] as const) {
      expect(canTransition('retired', to)).toBe(false);
      expect(canTransition('rejected', to)).toBe(false);
    }
  });
});
