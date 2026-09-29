// Precondiciones mínimas para abrir una orden: sin mandato vigente y snapshot verificado no hay orden (Fase 0).
// Los límites de riesgo (pérdida, exposición, kill switch) son del RiskCore de la Fase 1.

import { validateMarketSnapshot, validateStrategyMandate, type MarketSnapshot, type StrategyMandate } from './contracts.js';

export type PreconditionCode =
  | 'INVALID_CLOCK'
  | 'MISSING_MANDATE'
  | 'INVALID_MANDATE'
  | 'MANDATE_STRATEGY_MISMATCH'
  | 'MANDATE_NOT_ACTIVE'
  | 'MISSING_SNAPSHOT'
  | 'INVALID_SNAPSHOT'
  | 'SNAPSHOT_INSTRUMENT_MISMATCH'
  | 'SNAPSHOT_VENUE_MISMATCH'
  | 'INSTRUMENT_OUTSIDE_UNIVERSE'
  | 'SNAPSHOT_QUALITY'
  | 'SNAPSHOT_FROM_FUTURE'
  | 'SNAPSHOT_STALE';

export type PreconditionResult =
  | { readonly ok: true; readonly snapshot: MarketSnapshot; readonly mandate: StrategyMandate }
  | { readonly ok: false; readonly code: PreconditionCode; readonly reason: string };

export interface PreconditionInput {
  readonly strategy_id: string;
  readonly instrument: string;
  readonly snapshot: unknown;
  readonly mandate: unknown;
  readonly now: string;
}

const refuse = (code: PreconditionCode, reason: string): PreconditionResult => ({ ok: false, code, reason });

export function checkOrderPreconditions(input: PreconditionInput): PreconditionResult {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return refuse('INVALID_CLOCK', `reloj inválido: ${input.now}`);

  if (input.mandate === null || input.mandate === undefined) return refuse('MISSING_MANDATE', 'no hay mandato');
  const m = validateStrategyMandate(input.mandate);
  if (!m.ok) return refuse('INVALID_MANDATE', `mandato inválido: ${m.errors.join(', ')}`);
  const mandate = m.value;
  if (mandate.strategy_id !== input.strategy_id) {
    return refuse('MANDATE_STRATEGY_MISMATCH', `el mandato es de ${mandate.strategy_id}, no de ${input.strategy_id}`);
  }
  if (now < Date.parse(mandate.valid_from) || now >= Date.parse(mandate.valid_until)) {
    return refuse('MANDATE_NOT_ACTIVE', `mandato fuera de vigencia [${mandate.valid_from}, ${mandate.valid_until})`);
  }

  if (input.snapshot === null || input.snapshot === undefined) return refuse('MISSING_SNAPSHOT', 'no hay snapshot de mercado');
  const s = validateMarketSnapshot(input.snapshot);
  if (!s.ok) return refuse('INVALID_SNAPSHOT', `snapshot inválido: ${s.errors.join(', ')}`);
  const snapshot = s.value;
  if (snapshot.instrument !== input.instrument) {
    return refuse('SNAPSHOT_INSTRUMENT_MISMATCH', `snapshot de ${snapshot.instrument}, orden sobre ${input.instrument}`);
  }
  if (snapshot.venue !== mandate.venue) {
    return refuse('SNAPSHOT_VENUE_MISMATCH', `snapshot de ${snapshot.venue}, mandato para ${mandate.venue}`);
  }
  if (!mandate.universe.includes(input.instrument)) {
    return refuse('INSTRUMENT_OUTSIDE_UNIVERSE', `${input.instrument} no está en el universo del mandato`);
  }
  if (snapshot.quality !== 'verified') return refuse('SNAPSHOT_QUALITY', `calidad del snapshot: ${snapshot.quality}`);

  const providerTs = Date.parse(snapshot.provider_ts);
  if (providerTs > now || Date.parse(snapshot.received_ts) > now) {
    return refuse('SNAPSHOT_FROM_FUTURE', 'el snapshot tiene timestamps posteriores al reloj actual');
  }
  if (now - providerTs > mandate.max_snapshot_age_ms) {
    return refuse('SNAPSHOT_STALE', `snapshot con ${now - providerTs} ms > ${mandate.max_snapshot_age_ms} ms permitidos`);
  }
  return { ok: true, snapshot, mandate };
}
