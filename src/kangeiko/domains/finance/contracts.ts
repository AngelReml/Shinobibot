// Contratos del dominio financiero de Kangeiko (Fase 0): entidades, estados y validadores fail-closed.

export const FINANCE_SCHEMA_VERSION = 1 as const;

export interface FinanceEntity {
  readonly id: string;
  readonly created_at: string;
  readonly schema_version: typeof FINANCE_SCHEMA_VERSION;
  readonly source: string;
}

export type DataQuality = 'verified' | 'stale' | 'missing' | 'synthetic';
export type MarketType = 'spot' | 'perpetual' | 'future';

export interface Ohlcv {
  readonly interval: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface MarketSnapshot extends FinanceEntity {
  readonly venue: string;
  readonly instrument: string;
  readonly market_type: MarketType;
  readonly timezone: string;
  readonly provider_ts: string;
  readonly received_ts: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number | null;
  readonly volume: number | null;
  readonly depth: { readonly bid_size: number; readonly ask_size: number } | null;
  readonly ohlcv: Ohlcv | null;
  readonly quality: DataQuality;
  readonly payload_hash: string;
}

export type StrategyStatus = 'candidate' | 'incubating' | 'certified' | 'active' | 'paused' | 'retired' | 'rejected';

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface CostModel {
  readonly maker_fee_bps: number;
  readonly taker_fee_bps: number;
  readonly slippage_bps: number;
  readonly funding_bps_per_day: number;
}

export interface StrategySpec extends FinanceEntity {
  readonly strategy_id: string;
  readonly version: string;
  readonly hypothesis: string;
  readonly universe: readonly string[];
  readonly instrument: string;
  readonly inputs: readonly string[];
  readonly timeframe: string;
  readonly signal: string;
  readonly rules: { readonly entry: string; readonly exit: string; readonly sizing: string };
  readonly own_limits: { readonly max_position_notional: number; readonly max_loss_per_trade: number };
  readonly assumed_costs: CostModel;
  readonly periods: { readonly train: DateRange; readonly validation: DateRange; readonly forward: DateRange };
  readonly artifact_hash: string;
  readonly status: StrategyStatus;
}

export interface FactorLimit {
  readonly factor: string;
  readonly instruments: readonly string[];
  /** Tope de exposición neta (valor absoluto) sumando los instrumentos del factor. */
  readonly max_exposure: number;
}

export interface StrategyMandate extends FinanceEntity {
  readonly mandate_id: string;
  readonly strategy_id: string;
  readonly venue: string;
  readonly universe: readonly string[];
  readonly max_position_notional: number;
  readonly max_loss_per_trade: number;
  readonly max_loss_per_day: number;
  readonly max_loss_per_cycle: number;
  readonly max_gross_exposure: number;
  readonly max_net_exposure: number;
  readonly factors: readonly FactorLimit[];
  readonly max_open_positions: number;
  /** Fracción del capital asignado, en (0, 1]. */
  readonly max_drawdown: number;
  readonly max_orders_per_day: number;
  readonly max_slippage_bps: number;
  /** Fracción de la profundidad visible del lado que se consume, en (0, 1]. */
  readonly max_depth_fraction: number;
  readonly max_snapshot_age_ms: number;
  readonly max_clock_skew_ms: number;
  readonly valid_from: string;
  readonly valid_until: string;
  readonly retire_conditions: readonly string[];
}

export type GatewayDecision = 'accepted' | 'rejected' | 'blocked';

export type Evidence = Readonly<Record<string, string | number | boolean | null>>;

interface DecisionBase extends FinanceEntity {
  readonly strategy_id: string;
  readonly strategy_version: string;
  readonly hypothesis: string;
  readonly signal: { readonly name: string; readonly value: number };
  readonly probability: number | null;
}

/** Una decisión aceptada exige intent, snapshot y mandato; una rechazada o bloqueada se registra igualmente. */
export interface AcceptedDecision extends DecisionBase {
  readonly intent_id: string;
  readonly intent_seq: number;
  readonly snapshot_id: string;
  readonly snapshot_hash: string;
  readonly mandate_id: string;
  readonly gateway: { readonly decision: 'accepted'; readonly code: 'OK'; readonly reason: string; readonly evidence: Evidence };
}

export interface RefusedDecision extends DecisionBase {
  readonly intent_id: string | null;
  readonly intent_seq: number | null;
  readonly snapshot_id: string | null;
  readonly snapshot_hash: string | null;
  readonly mandate_id: string | null;
  readonly gateway: { readonly decision: 'rejected' | 'blocked'; readonly code: string; readonly reason: string; readonly evidence: Evidence };
}

export type DecisionRecord = AcceptedDecision | RefusedDecision;

// Una estrategia pausada vuelve a incubación y debe re-certificarse: nunca se reactiva en silencio.
const TRANSITIONS: Readonly<Record<StrategyStatus, readonly StrategyStatus[]>> = {
  candidate: ['incubating', 'rejected'],
  incubating: ['certified', 'rejected', 'retired'],
  certified: ['active', 'paused', 'retired'],
  active: ['paused', 'retired'],
  paused: ['incubating', 'retired'],
  retired: [],
  rejected: [],
};

export function canTransition(from: StrategyStatus, to: StrategyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableNum = (v: unknown) => v === null || isNum(v);
const isIso = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function checkEntity(o: Obj, errors: string[]): void {
  if (!isStr(o.id)) errors.push('id');
  if (!isIso(o.created_at)) errors.push('created_at');
  if (o.schema_version !== FINANCE_SCHEMA_VERSION) errors.push('schema_version');
  if (!isStr(o.source)) errors.push('source');
}

function result<T>(value: unknown, errors: string[]): Validation<T> {
  return errors.length ? { ok: false, errors } : { ok: true, value: value as T };
}

const QUALITIES: readonly string[] = ['verified', 'stale', 'missing', 'synthetic'];
const MARKET_TYPES: readonly string[] = ['spot', 'perpetual', 'future'];

export function validateMarketSnapshot(v: unknown): Validation<MarketSnapshot> {
  if (!isObj(v)) return { ok: false, errors: ['not_an_object'] };
  const errors: string[] = [];
  checkEntity(v, errors);
  for (const k of ['venue', 'instrument', 'timezone'] as const) if (!isStr(v[k])) errors.push(k);
  if (!MARKET_TYPES.includes(v.market_type as string)) errors.push('market_type');
  if (!isIso(v.provider_ts)) errors.push('provider_ts');
  if (!isIso(v.received_ts)) errors.push('received_ts');
  for (const k of ['bid', 'ask', 'mid', 'volume'] as const) if (!isNullableNum(v[k])) errors.push(k);
  if (isNum(v.bid) && isNum(v.ask) && v.bid > v.ask) errors.push('crossed_book');
  if (isNum(v.bid) && isNum(v.ask) && isNum(v.mid) && (v.mid < v.bid || v.mid > v.ask)) errors.push('mid_outside_spread');
  if (v.depth !== null && !(isObj(v.depth) && isNum(v.depth.bid_size) && isNum(v.depth.ask_size))) errors.push('depth');
  if (v.ohlcv !== null && !isObj(v.ohlcv)) errors.push('ohlcv');
  if (!QUALITIES.includes(v.quality as string)) errors.push('quality');
  if (!isHex64(v.payload_hash)) errors.push('payload_hash');
  return result<MarketSnapshot>(v, errors);
}

export const POSITIVE_MANDATE_FIELDS = [
  'max_position_notional',
  'max_loss_per_trade',
  'max_loss_per_day',
  'max_loss_per_cycle',
  'max_gross_exposure',
  'max_net_exposure',
  'max_open_positions',
  'max_orders_per_day',
  'max_slippage_bps',
  'max_snapshot_age_ms',
  'max_clock_skew_ms',
] as const;

export function validateStrategyMandate(v: unknown): Validation<StrategyMandate> {
  if (!isObj(v)) return { ok: false, errors: ['not_an_object'] };
  const errors: string[] = [];
  checkEntity(v, errors);
  if (!isStr(v.mandate_id)) errors.push('mandate_id');
  if (!isStr(v.strategy_id)) errors.push('strategy_id');
  if (!isStr(v.venue)) errors.push('venue');
  if (!isStrArray(v.universe) || v.universe.length === 0) errors.push('universe');
  for (const k of POSITIVE_MANDATE_FIELDS) {
    const n = v[k];
    if (!isNum(n) || n <= 0) errors.push(k);
  }
  for (const k of ['max_drawdown', 'max_depth_fraction'] as const) {
    const n = v[k];
    if (!isNum(n) || n <= 0 || n > 1) errors.push(k);
  }
  if (!Number.isInteger(v.max_open_positions) || !Number.isInteger(v.max_orders_per_day)) errors.push('integer_counts');
  const factorsOk = Array.isArray(v.factors) && v.factors.every((f) =>
    isObj(f) && isStr(f.factor) && isStrArray(f.instruments) && f.instruments.length > 0 && isNum(f.max_exposure) && f.max_exposure > 0);
  if (!factorsOk) errors.push('factors');
  if (!isIso(v.valid_from)) errors.push('valid_from');
  if (!isIso(v.valid_until)) errors.push('valid_until');
  if (isIso(v.valid_from) && isIso(v.valid_until) && Date.parse(v.valid_from) >= Date.parse(v.valid_until)) errors.push('validity_window');
  if (!isStrArray(v.retire_conditions)) errors.push('retire_conditions');
  return result<StrategyMandate>(v, errors);
}

export function validateDecisionRecord(v: unknown): Validation<DecisionRecord> {
  if (!isObj(v)) return { ok: false, errors: ['not_an_object'] };
  const errors: string[] = [];
  checkEntity(v, errors);
  for (const k of ['strategy_id', 'strategy_version', 'hypothesis'] as const) if (!isStr(v[k])) errors.push(k);
  if (!(isObj(v.signal) && isStr(v.signal.name) && isNum(v.signal.value))) errors.push('signal');
  if (v.probability !== null && !(isNum(v.probability) && v.probability >= 0 && v.probability <= 1)) errors.push('probability');
  const g = v.gateway;
  if (!(isObj(g) && ['accepted', 'rejected', 'blocked'].includes(g.decision as string) && isStr(g.code) && isStr(g.reason) && isObj(g.evidence))) {
    errors.push('gateway');
  } else if (g.decision === 'accepted') {
    if (g.code !== 'OK') errors.push('gateway.code');
    if (!isStr(v.intent_id)) errors.push('intent_id');
    if (!Number.isInteger(v.intent_seq)) errors.push('intent_seq');
    if (!isStr(v.snapshot_id)) errors.push('snapshot_id');
    if (!isHex64(v.snapshot_hash)) errors.push('snapshot_hash');
    if (!isStr(v.mandate_id)) errors.push('mandate_id');
  } else {
    if (v.intent_id !== null && !isStr(v.intent_id)) errors.push('intent_id');
    if (v.intent_seq !== null && !Number.isInteger(v.intent_seq)) errors.push('intent_seq');
    if (v.snapshot_id !== null && !isStr(v.snapshot_id)) errors.push('snapshot_id');
    if (v.snapshot_hash !== null && !isHex64(v.snapshot_hash)) errors.push('snapshot_hash');
    if (v.mandate_id !== null && !isStr(v.mandate_id)) errors.push('mandate_id');
  }
  return result<DecisionRecord>(v, errors);
}
