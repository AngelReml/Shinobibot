// RiskCore: techo inmutable de límites y evaluación pura de un intent contra mandato, cartera y mercado.

import { POSITIVE_MANDATE_FIELDS, type Evidence, type MarketSnapshot, type StrategyMandate, type Validation } from './contracts.js';
import type { OrderIntent } from './order_intent.js';

const FRACTION_FIELDS = ['max_drawdown', 'max_depth_fraction'] as const;
export const CAPPED_FIELDS = [...POSITIVE_MANDATE_FIELDS, ...FRACTION_FIELDS] as const;

/** Techo del core. Lo fija el operador al construir el gateway; ningún mandato puede superarlo. */
export type RiskCaps = { readonly [K in (typeof CAPPED_FIELDS)[number]]: number };

export function validateRiskCaps(v: unknown): Validation<RiskCaps> {
  if (typeof v !== 'object' || v === null) return { ok: false, errors: ['not_an_object'] };
  const o = v as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of CAPPED_FIELDS) {
    const n = o[k];
    const fraction = (FRACTION_FIELDS as readonly string[]).includes(k);
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || (fraction && n > 1)) errors.push(k);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: v as RiskCaps };
}

export function mandateFieldsAboveCaps(m: StrategyMandate, caps: RiskCaps): string[] {
  const above: string[] = CAPPED_FIELDS.filter((k) => m[k] > caps[k]);
  // Un factor no puede tener más exposición que la neta que el core permite.
  for (const f of m.factors) if (f.max_exposure > caps.max_net_exposure) above.push(`factors.${f.factor}`);
  return above;
}

export interface PortfolioState {
  readonly equity: number;
  readonly peak_equity: number;
  readonly realized_pnl_day: number;
  readonly realized_pnl_cycle: number;
  /** Nocional con signo por instrumento: positivo = largo, negativo = corto. */
  readonly positions: Readonly<Record<string, number>>;
}

export function validatePortfolioState(v: unknown): Validation<PortfolioState> {
  if (typeof v !== 'object' || v === null) return { ok: false, errors: ['not_an_object'] };
  const o = v as Record<string, unknown>;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const errors: string[] = [];
  if (!fin(o.equity) || o.equity <= 0) errors.push('equity');
  if (!fin(o.peak_equity) || (fin(o.equity) && o.peak_equity < o.equity)) errors.push('peak_equity');
  if (!fin(o.realized_pnl_day)) errors.push('realized_pnl_day');
  if (!fin(o.realized_pnl_cycle)) errors.push('realized_pnl_cycle');
  const p = o.positions;
  if (typeof p !== 'object' || p === null || Array.isArray(p) || !Object.values(p).every(fin)) errors.push('positions');
  return errors.length ? { ok: false, errors } : { ok: true, value: v as PortfolioState };
}

export type RiskCode =
  | 'MAX_ORDERS_PER_DAY'
  | 'NO_QUOTE'
  | 'INVALID_STOP'
  | 'MAX_DRAWDOWN'
  | 'MAX_SLIPPAGE'
  | 'NO_LIQUIDITY_DATA'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'MAX_LOSS_PER_TRADE'
  | 'MAX_LOSS_PER_DAY'
  | 'MAX_LOSS_PER_CYCLE'
  | 'MAX_POSITION'
  | 'MAX_GROSS_EXPOSURE'
  | 'MAX_NET_EXPOSURE'
  | 'MAX_FACTOR_EXPOSURE'
  | 'MAX_OPEN_POSITIONS';

export type RiskResult =
  | { readonly ok: true; readonly evidence: Evidence; readonly position_after: number }
  | {
      readonly ok: false;
      readonly decision: 'rejected' | 'blocked';
      readonly code: RiskCode;
      readonly reason: string;
      readonly evidence: Evidence;
      /** Solo cuando el drawdown actual ya agotó el mandato: el gateway enclava el kill switch. */
      readonly tripKillSwitch: boolean;
    };

// Tolerancia relativa: estar exactamente en el límite se permite, pasarse no, aunque haya ruido de coma flotante.
const exceeds = (value: number, limit: number) => value > limit + 1e-9 * Math.max(1, Math.abs(limit));
const ZERO = 1e-9;

/**
 * Pérdida máxima estimada del trade = cantidad × |entrada − stop| + nocional × slippage esperado.
 * Las comisiones no entran aún: el modelo de costes del venue llega con la PaperArena (Fase 2).
 */
export function evaluateRisk(
  intent: OrderIntent,
  snapshot: MarketSnapshot,
  mandate: StrategyMandate,
  state: PortfolioState,
  ordersToday: number,
): RiskResult {
  const ev: Record<string, string | number | boolean | null> = { orders_today: ordersToday };
  const fail = (decision: 'rejected' | 'blocked', code: RiskCode, reason: string, extra: Evidence = {}, tripKillSwitch = false): RiskResult =>
    ({ ok: false, decision, code, reason, evidence: { ...ev, ...extra }, tripKillSwitch });

  // Depende solo del estado, no del intent: si el drawdown ya agotó el mandato, se enclava pase lo que pase.
  const drawdownNow = (state.peak_equity - state.equity) / state.peak_equity;
  ev.drawdown_now = drawdownNow;
  if (drawdownNow >= mandate.max_drawdown - ZERO) {
    return fail('blocked', 'MAX_DRAWDOWN', `drawdown actual ${drawdownNow} agota el mandato`, { limit: mandate.max_drawdown }, true);
  }

  if (ordersToday >= mandate.max_orders_per_day) {
    return fail('rejected', 'MAX_ORDERS_PER_DAY', `ya hay ${ordersToday} órdenes hoy`, { limit: mandate.max_orders_per_day });
  }
  if (snapshot.bid === null || snapshot.ask === null) return fail('blocked', 'NO_QUOTE', 'el snapshot no trae bid y ask');

  const buy = intent.side === 'buy';
  const entry = intent.limit_price ?? (buy ? snapshot.ask : snapshot.bid);
  const stopDistance = buy ? entry - intent.stop_price : intent.stop_price - entry;
  ev.entry_price = entry;
  if (stopDistance <= 0) return fail('rejected', 'INVALID_STOP', `stop ${intent.stop_price} no protege una ${intent.side} a ${entry}`);

  if (exceeds(intent.expected_slippage_bps, mandate.max_slippage_bps)) {
    return fail('rejected', 'MAX_SLIPPAGE', `slippage esperado ${intent.expected_slippage_bps} bps`, { limit: mandate.max_slippage_bps });
  }

  if (snapshot.depth === null) return fail('blocked', 'NO_LIQUIDITY_DATA', 'el snapshot no trae profundidad');
  const visible = buy ? snapshot.depth.ask_size : snapshot.depth.bid_size;
  const usable = visible * mandate.max_depth_fraction;
  if (exceeds(intent.quantity, usable)) {
    return fail('rejected', 'INSUFFICIENT_LIQUIDITY', `cantidad ${intent.quantity} > ${usable} utilizable`, { limit: usable, visible_depth: visible });
  }

  const notional = intent.quantity * entry;
  const worstLoss = intent.quantity * stopDistance + (notional * intent.expected_slippage_bps) / 10_000;
  ev.notional = notional;
  ev.worst_loss = worstLoss;
  if (exceeds(worstLoss, mandate.max_loss_per_trade)) {
    return fail('rejected', 'MAX_LOSS_PER_TRADE', `pérdida máxima ${worstLoss}`, { limit: mandate.max_loss_per_trade });
  }
  const lossDay = Math.max(0, -state.realized_pnl_day) + worstLoss;
  if (exceeds(lossDay, mandate.max_loss_per_day)) {
    return fail('rejected', 'MAX_LOSS_PER_DAY', `pérdida del día llegaría a ${lossDay}`, { limit: mandate.max_loss_per_day, observed: lossDay });
  }
  const lossCycle = Math.max(0, -state.realized_pnl_cycle) + worstLoss;
  if (exceeds(lossCycle, mandate.max_loss_per_cycle)) {
    return fail('rejected', 'MAX_LOSS_PER_CYCLE', `pérdida del ciclo llegaría a ${lossCycle}`, { limit: mandate.max_loss_per_cycle, observed: lossCycle });
  }
  const drawdownAfter = (state.peak_equity - (state.equity - worstLoss)) / state.peak_equity;
  if (exceeds(drawdownAfter, mandate.max_drawdown)) {
    return fail('rejected', 'MAX_DRAWDOWN', `el peor caso dejaría el drawdown en ${drawdownAfter}`, { limit: mandate.max_drawdown, observed: drawdownAfter });
  }

  const signed = buy ? notional : -notional;
  const current = state.positions[intent.instrument] ?? 0;
  const after = current + signed;
  const positions: Record<string, number> = { ...state.positions, [intent.instrument]: after };
  ev.position_after = after;
  if (exceeds(Math.abs(after), mandate.max_position_notional)) {
    return fail('rejected', 'MAX_POSITION', `posición en ${intent.instrument} llegaría a ${after}`, { limit: mandate.max_position_notional });
  }
  const gross = Object.values(positions).reduce((s, x) => s + Math.abs(x), 0);
  const net = Math.abs(Object.values(positions).reduce((s, x) => s + x, 0));
  ev.gross_after = gross;
  ev.net_after = net;
  if (exceeds(gross, mandate.max_gross_exposure)) {
    return fail('rejected', 'MAX_GROSS_EXPOSURE', `exposición bruta llegaría a ${gross}`, { limit: mandate.max_gross_exposure });
  }
  if (exceeds(net, mandate.max_net_exposure)) {
    return fail('rejected', 'MAX_NET_EXPOSURE', `exposición neta llegaría a ${net}`, { limit: mandate.max_net_exposure });
  }
  for (const f of mandate.factors) {
    if (!f.instruments.includes(intent.instrument)) continue;
    const exposure = Math.abs(f.instruments.reduce((s, i) => s + (positions[i] ?? 0), 0));
    if (exceeds(exposure, f.max_exposure)) {
      return fail('rejected', 'MAX_FACTOR_EXPOSURE', `factor ${f.factor} llegaría a ${exposure}`, { factor: f.factor, limit: f.max_exposure, observed: exposure });
    }
  }
  const open = Object.values(positions).filter((x) => Math.abs(x) > ZERO).length;
  ev.open_positions_after = open;
  if (open > mandate.max_open_positions) {
    return fail('rejected', 'MAX_OPEN_POSITIONS', `quedarían ${open} posiciones abiertas`, { limit: mandate.max_open_positions });
  }
  return { ok: true, evidence: ev, position_after: after };
}
