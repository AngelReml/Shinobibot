import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { buildTradeReceipt, signTradeReceipt, verifySignedTradeReceipt, verifyTradeReceipt, TradeReceiptInvariantError, type TradeReceiptCore } from '../domains/finance/index.js';

const closed: TradeReceiptCore = {
  id: 'receipt-1', created_at: '2026-01-15T13:00:00.000Z', schema_version: 1, source: 'paper:fixture',
  decision_id: 'decision-1', strategy_id: 'sma_cross',
  intent: { side: 'buy', quantity: 0.01, limit_price: null },
  gateway_decision: 'accepted',
  order: { order_id: 'o-1', side: 'buy', quantity: 0.01, price: null, sent_at: '2026-01-15T12:00:01.500Z' },
  fill: { quantity: 0.01, price: 42002, filled_at: '2026-01-15T12:00:02.000Z', partial: false },
  costs: { liquidity: 'taker', fees: 0.42, funding: 0.05, slippage_expected_bps: 1, slippage_real_bps: 0.24 },
  pnl: { gross: 1.5, net: 1.03 },
  exposure_after: 0,
  prev_receipt_hash: '',
};

const refused: TradeReceiptCore = { ...closed, gateway_decision: 'blocked', order: null, fill: null, costs: null, pnl: null };

describe('finance F0 — TradeReceipt', () => {
  it('produce un hash de contenido que verifica', () => {
    const r = buildTradeReceipt(closed);
    expect(r.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyTradeReceipt(r)).toEqual({ valid: true, reason: 'ok' });
  });

  it('el hash no depende del orden de las claves', () => {
    const reordered = Object.fromEntries(Object.entries(closed).reverse()) as unknown as TradeReceiptCore;
    expect(buildTradeReceipt(reordered).content_hash).toBe(buildTradeReceipt(closed).content_hash);
  });

  it('cualquier campo modificado rompe el hash', () => {
    const r = buildTradeReceipt(closed);
    expect(verifyTradeReceipt({ ...r, exposure_after: 1 })).toEqual({ valid: false, reason: 'hash_mismatch' });
    expect(verifyTradeReceipt({ ...r, fill: { ...r.fill!, price: 42001 } })).toEqual({ valid: false, reason: 'hash_mismatch' });
  });

  it('una decisión rechazada o bloqueada genera recibo, pero sin orden, fill ni PnL', () => {
    expect(verifyTradeReceipt(buildTradeReceipt(refused)).valid).toBe(true);
    expect(() => buildTradeReceipt({ ...refused, fill: closed.fill })).toThrow(TradeReceiptInvariantError);
    expect(() => buildTradeReceipt({ ...refused, gateway_decision: 'rejected', order: closed.order })).toThrow(TradeReceiptInvariantError);
  });

  it('no hay fill sin orden ni PnL sin costes declarados', () => {
    expect(() => buildTradeReceipt({ ...closed, order: null })).toThrow(/fill sin orden/);
    expect(() => buildTradeReceipt({ ...closed, costs: null })).toThrow(/sin costes/);
  });

  it('el PnL neto debe cuadrar con bruto − comisiones − funding', () => {
    expect(() => buildTradeReceipt({ ...closed, pnl: { gross: 1.5, net: 1.5 } })).toThrow(/no cuadra/);
  });

  it('un recibo falsificado con hash recalculado sigue fallando por invariante', () => {
    const forged = { ...buildTradeReceipt(refused), fill: closed.fill };
    expect(verifyTradeReceipt(forged)).toEqual({ valid: false, reason: 'invariant_violation' });
  });
});

describe('finance F1 — firma Ed25519 del TradeReceipt', () => {
  const keys = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  };
  const k = keys();

  it('firma y verifica, también contra la pública esperada', () => {
    const r = signTradeReceipt(closed, k);
    expect(r.alg).toBe('ed25519');
    expect(verifySignedTradeReceipt(r)).toEqual({ valid: true, reason: 'ok' });
    expect(verifySignedTradeReceipt(r, k.publicKeyPem)).toEqual({ valid: true, reason: 'ok' });
  });

  it('el hash firmado es el mismo que el del recibo sin firmar', () => {
    expect(signTradeReceipt(closed, k).content_hash).toBe(buildTradeReceipt(closed).content_hash);
  });

  it('otra identidad, firma alterada o contenido alterado no verifican', () => {
    const r = signTradeReceipt(closed, k);
    expect(verifySignedTradeReceipt(r, keys().publicKeyPem)).toEqual({ valid: false, reason: 'signature_mismatch' });
    const flipped = (r.signature[0] === 'a' ? 'b' : 'a') + r.signature.slice(1);
    expect(verifySignedTradeReceipt({ ...r, signature: flipped })).toEqual({ valid: false, reason: 'signature_mismatch' });
    expect(verifySignedTradeReceipt({ ...r, exposure_after: 5 })).toEqual({ valid: false, reason: 'hash_mismatch' });
    // Re-firmar con otra clave y cambiar la pública declarada no engaña si se exige la identidad esperada.
    const other = keys();
    expect(verifySignedTradeReceipt(signTradeReceipt(closed, other), k.publicKeyPem)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('una decisión aceptada sin intent no produce recibo', () => {
    expect(() => buildTradeReceipt({ ...closed, intent: null })).toThrow(/exige intent/);
    expect(verifyTradeReceipt(buildTradeReceipt({ ...refused, intent: null })).valid).toBe(true);
  });
});
