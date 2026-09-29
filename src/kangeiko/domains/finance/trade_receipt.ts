// TradeReceipt: une intención, decisión, orden, fill, costes y PnL con hash de contenido y firma Ed25519.

import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'crypto';
import type { FinanceEntity, GatewayDecision } from './contracts.js';

export type Side = 'buy' | 'sell';

export interface TradeCosts {
  readonly liquidity: 'maker' | 'taker';
  readonly fees: number;
  readonly funding: number;
  readonly slippage_expected_bps: number;
  readonly slippage_real_bps: number;
}

export interface TradeReceiptCore extends FinanceEntity {
  readonly decision_id: string;
  readonly strategy_id: string;
  /** null solo en intentos malformados, que nunca pueden ser aceptados. */
  readonly intent: { readonly side: Side; readonly quantity: number; readonly limit_price: number | null } | null;
  readonly gateway_decision: GatewayDecision;
  readonly order: { readonly order_id: string; readonly side: Side; readonly quantity: number; readonly price: number | null; readonly sent_at: string } | null;
  readonly fill: { readonly quantity: number; readonly price: number; readonly filled_at: string; readonly partial: boolean } | null;
  readonly costs: TradeCosts | null;
  /** El slippage ya está dentro del precio de fill: neto = bruto − comisiones − funding. */
  readonly pnl: { readonly gross: number; readonly net: number } | null;
  readonly exposure_after: number;
  /** content_hash del recibo anterior de la misma estrategia ('' para el primero). */
  readonly prev_receipt_hash: string;
}

export interface TradeReceipt extends TradeReceiptCore {
  readonly content_hash: string;
}

export interface SignedTradeReceipt extends TradeReceipt {
  readonly alg: 'ed25519';
  readonly signature: string;
  readonly public_key_pem: string;
}

export interface ReceiptKeypair {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

export class TradeReceiptInvariantError extends Error {
  constructor(reason: string) {
    super(`TradeReceipt inválido: ${reason}`);
    this.name = 'TradeReceiptInvariantError';
  }
}

const PNL_TOLERANCE = 1e-9;

function assertInvariants(r: TradeReceiptCore): void {
  if (r.gateway_decision === 'accepted' && !r.intent) throw new TradeReceiptInvariantError('una decisión aceptada exige intent');
  if (r.gateway_decision !== 'accepted' && (r.order || r.fill || r.costs || r.pnl)) {
    throw new TradeReceiptInvariantError(`una decisión ${r.gateway_decision} no puede tener orden, fill, costes ni PnL`);
  }
  if (r.fill && !r.order) throw new TradeReceiptInvariantError('fill sin orden');
  if (r.pnl && (!r.fill || !r.costs)) throw new TradeReceiptInvariantError('PnL sin fill o sin costes declarados');
  if (r.pnl && r.costs && Math.abs(r.pnl.gross - r.costs.fees - r.costs.funding - r.pnl.net) > PNL_TOLERANCE) {
    throw new TradeReceiptInvariantError('PnL neto no cuadra con bruto − comisiones − funding');
  }
}

// Serialización con claves ordenadas: el hash no depende del orden en que se construyó el objeto.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashCore(core: TradeReceiptCore): string {
  return createHash('sha256').update(canonical(core)).digest('hex');
}

export function buildTradeReceipt(core: TradeReceiptCore): TradeReceipt {
  assertInvariants(core);
  return { ...core, content_hash: hashCore(core) };
}

export function signTradeReceipt(core: TradeReceiptCore, keys: ReceiptKeypair): SignedTradeReceipt {
  const receipt = buildTradeReceipt(core);
  const signature = edSign(null, Buffer.from(receipt.content_hash), createPrivateKey(keys.privateKeyPem)).toString('hex');
  return { ...receipt, alg: 'ed25519', signature, public_key_pem: keys.publicKeyPem };
}

export type ReceiptVerification = { valid: boolean; reason: 'ok' | 'hash_mismatch' | 'invariant_violation' | 'signature_mismatch' | 'malformed' };

export function verifyTradeReceipt(r: TradeReceipt): ReceiptVerification {
  const { content_hash, ...rest } = r;
  const { alg: _alg, signature: _sig, public_key_pem: _pub, ...core } = rest as Partial<SignedTradeReceipt> & TradeReceiptCore;
  try {
    assertInvariants(core);
  } catch {
    return { valid: false, reason: 'invariant_violation' };
  }
  return hashCore(core) === content_hash ? { valid: true, reason: 'ok' } : { valid: false, reason: 'hash_mismatch' };
}

/** Verifica hash, invariantes y firma. Con `expectedPublicKeyPem`, exige además que firme esa identidad. */
export function verifySignedTradeReceipt(r: SignedTradeReceipt, expectedPublicKeyPem?: string): ReceiptVerification {
  const base = verifyTradeReceipt(r);
  if (!base.valid) return base;
  try {
    if (r.alg !== 'ed25519') return { valid: false, reason: 'malformed' };
    if (expectedPublicKeyPem !== undefined && expectedPublicKeyPem !== r.public_key_pem) return { valid: false, reason: 'signature_mismatch' };
    const ok = edVerify(null, Buffer.from(r.content_hash), createPublicKey(r.public_key_pem), Buffer.from(r.signature, 'hex'));
    return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
