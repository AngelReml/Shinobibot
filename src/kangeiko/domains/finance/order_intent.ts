// OrderIntent: lo único que una estrategia puede enviar al gateway. Campos cerrados: cualquier extra se bloquea.

import type { Validation } from './contracts.js';
import type { Side } from './trade_receipt.js';

export interface OrderIntent {
  readonly intent_id: string;
  /** Secuencia estrictamente creciente por estrategia: detecta mensajes reordenados o repetidos. */
  readonly seq: number;
  readonly strategy_id: string;
  readonly strategy_version: string;
  readonly instrument: string;
  readonly side: Side;
  readonly quantity: number;
  readonly limit_price: number | null;
  /** Obligatorio: sin stop no se puede acotar la pérdida del trade. */
  readonly stop_price: number;
  readonly expected_slippage_bps: number;
  readonly created_at: string;
  readonly hypothesis: string;
  readonly signal: { readonly name: string; readonly value: number };
  readonly probability: number | null;
}

const INTENT_FIELDS: ReadonlySet<string> = new Set([
  'intent_id', 'seq', 'strategy_id', 'strategy_version', 'instrument', 'side', 'quantity', 'limit_price',
  'stop_price', 'expected_slippage_bps', 'created_at', 'hypothesis', 'signal', 'probability',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function unknownIntentFields(v: unknown): string[] {
  return isObj(v) ? Object.keys(v).filter((k) => !INTENT_FIELDS.has(k)) : [];
}

export function validateOrderIntent(v: unknown): Validation<OrderIntent> {
  if (!isObj(v)) return { ok: false, errors: ['not_an_object'] };
  const errors: string[] = [];
  for (const k of ['intent_id', 'strategy_id', 'strategy_version', 'instrument', 'hypothesis'] as const) if (!isStr(v[k])) errors.push(k);
  if (!Number.isSafeInteger(v.seq) || (v.seq as number) < 0) errors.push('seq');
  if (v.side !== 'buy' && v.side !== 'sell') errors.push('side');
  if (!isPos(v.quantity)) errors.push('quantity');
  if (v.limit_price !== null && !isPos(v.limit_price)) errors.push('limit_price');
  if (!isPos(v.stop_price)) errors.push('stop_price');
  if (typeof v.expected_slippage_bps !== 'number' || !Number.isFinite(v.expected_slippage_bps) || v.expected_slippage_bps < 0) {
    errors.push('expected_slippage_bps');
  }
  if (!(typeof v.created_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v.created_at) && Number.isFinite(Date.parse(v.created_at)))) {
    errors.push('created_at');
  }
  const s = v.signal;
  if (!(isObj(s) && isStr(s.name) && typeof s.value === 'number' && Number.isFinite(s.value))) errors.push('signal');
  const p = v.probability;
  if (p !== null && !(typeof p === 'number' && p >= 0 && p <= 1)) errors.push('probability');
  return errors.length ? { ok: false, errors } : { ok: true, value: v as unknown as OrderIntent };
}
