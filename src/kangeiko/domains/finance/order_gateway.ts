// OrderGateway: único punto por el que pasa un intent. Decide accepted/rejected/blocked, firma el recibo y lo
// encadena en el ledger. El mandato, el techo de riesgo y el kill switch quedan fuera del alcance de la estrategia.

import { FINANCE_SCHEMA_VERSION, validateStrategyMandate, type DecisionRecord, type Evidence, type GatewayDecision, type MarketSnapshot, type StrategyMandate } from './contracts.js';
import { FinanceLedgerCorruptError, type FinanceLedger } from './finance_ledger.js';
import { unknownIntentFields, validateOrderIntent, type OrderIntent } from './order_intent.js';
import { checkOrderPreconditions, type PreconditionCode } from './preconditions.js';
import { evaluateRisk, mandateFieldsAboveCaps, validatePortfolioState, validateRiskCaps, type RiskCaps, type RiskCode } from './risk_core.js';
import { signTradeReceipt, verifySignedTradeReceipt, type ReceiptKeypair, type SignedTradeReceipt, type TradeReceiptCore } from './trade_receipt.js';

export type GatewayCode =
  | 'OK'
  | PreconditionCode
  | RiskCode
  | 'KILL_SWITCH'
  | 'UNKNOWN_FIELDS'
  | 'INVALID_INTENT'
  | 'STRATEGY_MISMATCH'
  | 'DUPLICATE_INTENT'
  | 'OUT_OF_ORDER'
  | 'CLOCK_SKEW'
  | 'CLOCK_REGRESSION'
  | 'MARKET_DATA_FAILURE'
  | 'UNKNOWN_STATE'
  | 'LEDGER_FAILURE';

export interface GatewayOutcome {
  readonly decision: GatewayDecision;
  readonly code: GatewayCode;
  readonly reason: string;
  readonly evidence: Evidence;
  /** null solo si no se pudo registrar (fallo del ledger o reloj inservible): entonces el kill switch está enclavado. */
  readonly decision_record: DecisionRecord | null;
  readonly receipt: SignedTradeReceipt | null;
}

/** Lo único que recibe una estrategia. */
export interface StrategyPort {
  submit(intent: unknown): GatewayOutcome;
}

export interface KillSwitchState {
  readonly tripped: boolean;
  readonly reason: string | null;
  readonly at: string | null;
}

export interface GatewayConfig {
  readonly ledger: FinanceLedger;
  readonly mandate: unknown;
  readonly caps: unknown;
  readonly keys: ReceiptKeypair;
  readonly marketData: (instrument: string) => unknown;
  readonly portfolio: () => unknown;
  readonly now?: () => string;
  readonly source?: string;
}

export class GatewayConfigError extends Error {
  constructor(reason: string) {
    super(`OrderGateway no arranca: ${reason}`);
    this.name = 'GatewayConfigError';
  }
}

export const KILL_SWITCH_RESET_CONFIRMATION = 'RESET_KILL_SWITCH';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const utcDay = (iso: string) => iso.slice(0, 10);

interface Attempt {
  intent: OrderIntent | null;
  raw: unknown;
  snapshot: MarketSnapshot | null;
  positionNow: number;
}

export class OrderGateway {
  readonly mandate: StrategyMandate;
  readonly caps: RiskCaps;
  private readonly ledger: FinanceLedger;
  private readonly keys: ReceiptKeypair;
  private readonly marketData: (instrument: string) => unknown;
  private readonly portfolio: () => unknown;
  private readonly now: () => string;
  private readonly source: string;

  private attempts = 0;
  private readonly seenIntents = new Set<string>();
  private lastSeq: number | null = null;
  private readonly acceptedAt: string[] = [];
  private lastReceiptHash = '';
  private lastClockMs: number | null = null;
  private kill: KillSwitchState = { tripped: false, reason: null, at: null };

  constructor(cfg: GatewayConfig) {
    const m = validateStrategyMandate(cfg.mandate);
    if (!m.ok) throw new GatewayConfigError(`mandato inválido (${m.errors.join(', ')})`);
    const c = validateRiskCaps(cfg.caps);
    if (!c.ok) throw new GatewayConfigError(`techo de riesgo inválido (${c.errors.join(', ')})`);
    const above = mandateFieldsAboveCaps(m.value, c.value);
    if (above.length) throw new GatewayConfigError(`el mandato supera el techo del core en: ${above.join(', ')}`);

    this.mandate = deepFreeze(structuredClone(m.value));
    this.caps = deepFreeze(structuredClone(c.value));
    this.ledger = cfg.ledger;
    this.keys = cfg.keys;
    this.marketData = cfg.marketData;
    this.portfolio = cfg.portfolio;
    this.now = cfg.now ?? (() => new Date().toISOString());
    this.source = cfg.source ?? 'order_gateway';

    this.assertKeysWork();
    this.rebuildFromLedger();
  }

  strategyPort(): StrategyPort {
    return Object.freeze({ submit: (intent: unknown) => this.submit(intent) });
  }

  killSwitch(): KillSwitchState {
    return { ...this.kill };
  }

  /** Enclava el kill switch. Lo puede llamar el operador o el propio gateway; nunca la estrategia. */
  tripKillSwitch(reason: string): void {
    this.trip(reason, this.now());
  }

  /** Recuperación manual: exige confirmación explícita y queda en el ledger. Si no se puede registrar, sigue enclavado. */
  resetKillSwitch(req: { operator: string; reason: string; confirm: string }): void {
    if (!this.kill.tripped) throw new Error('el kill switch no está enclavado');
    if (req.confirm !== KILL_SWITCH_RESET_CONFIRMATION || !req.operator?.trim() || !req.reason?.trim()) {
      throw new Error(`reset rechazado: hace falta operator, reason y confirm = ${KILL_SWITCH_RESET_CONFIRMATION}`);
    }
    const at = this.now();
    this.ledger.append('kill_switch', 'kill_switch', { state: 'reset', operator: req.operator, reason: req.reason, at });
    this.kill = { tripped: false, reason: null, at };
  }

  submit(raw: unknown): GatewayOutcome {
    const t = this.now();
    const tMs = Date.parse(t);
    // Con un reloj inservible no hay marca de tiempo fiable para el recibo: se enclava y no se registra la decisión.
    if (!Number.isFinite(tMs) || (this.lastClockMs !== null && tMs < this.lastClockMs)) {
      const code = Number.isFinite(tMs) ? 'CLOCK_REGRESSION' : 'INVALID_CLOCK';
      this.trip(`reloj del gateway: ${code} (${t})`, String(t));
      return { decision: 'blocked', code, reason: `reloj del gateway inservible: ${t}`, evidence: { clock: String(t) }, decision_record: null, receipt: null };
    }

    const a: Attempt = { intent: null, raw, snapshot: null, positionNow: 0 };
    const extra = unknownIntentFields(raw);
    const v = extra.length ? null : validateOrderIntent(raw);
    if (v?.ok && v.value.strategy_id === this.mandate.strategy_id) a.intent = v.value;

    if (this.kill.tripped) return this.finish(t, a, 'blocked', 'KILL_SWITCH', `kill switch enclavado: ${this.kill.reason}`);
    if (extra.length) return this.finish(t, a, 'blocked', 'UNKNOWN_FIELDS', `campos no permitidos en el intent: ${extra.join(', ')}`);
    if (!v || !v.ok) return this.finish(t, a, 'blocked', 'INVALID_INTENT', `intent inválido: ${v ? v.errors.join(', ') : 'no es un objeto'}`);
    const intent = v.value;
    if (intent.strategy_id !== this.mandate.strategy_id) {
      return this.finish(t, a, 'blocked', 'STRATEGY_MISMATCH', `este gateway solo atiende a ${this.mandate.strategy_id}`, { claimed_strategy: intent.strategy_id });
    }
    if (this.seenIntents.has(intent.intent_id)) return this.finish(t, a, 'rejected', 'DUPLICATE_INTENT', `intent ${intent.intent_id} ya procesado`);
    if (this.lastSeq !== null && intent.seq <= this.lastSeq) {
      return this.finish(t, a, 'rejected', 'OUT_OF_ORDER', `seq ${intent.seq} ≤ última ${this.lastSeq}`, { last_seq: this.lastSeq });
    }
    const skew = Math.abs(tMs - Date.parse(intent.created_at));
    if (skew > this.mandate.max_clock_skew_ms) {
      return this.finish(t, a, 'blocked', 'CLOCK_SKEW', `desfase de ${skew} ms con el intent`, { skew_ms: skew, limit: this.mandate.max_clock_skew_ms });
    }

    let rawSnapshot: unknown;
    try {
      rawSnapshot = this.marketData(intent.instrument);
    } catch (e) {
      return this.finish(t, a, 'blocked', 'MARKET_DATA_FAILURE', `datos de mercado no disponibles: ${(e as Error).message}`);
    }
    const pre = checkOrderPreconditions({ strategy_id: intent.strategy_id, instrument: intent.instrument, snapshot: rawSnapshot, mandate: this.mandate, now: t });
    if (!pre.ok) return this.finish(t, a, 'blocked', pre.code, pre.reason);
    a.snapshot = pre.snapshot;

    let rawState: unknown;
    try {
      rawState = this.portfolio();
    } catch (e) {
      return this.finish(t, a, 'blocked', 'UNKNOWN_STATE', `estado de cartera no disponible: ${(e as Error).message}`);
    }
    const st = validatePortfolioState(rawState);
    if (!st.ok) return this.finish(t, a, 'blocked', 'UNKNOWN_STATE', `estado de cartera inválido: ${st.errors.join(', ')}`);
    a.positionNow = st.value.positions[intent.instrument] ?? 0;

    const ordersToday = this.acceptedAt.filter((x) => utcDay(x) === utcDay(t)).length;
    const risk = evaluateRisk(intent, pre.snapshot, this.mandate, st.value, ordersToday);
    if (!risk.ok) {
      if (risk.tripKillSwitch) this.trip(risk.reason, t);
      return this.finish(t, a, risk.decision, risk.code, risk.reason, risk.evidence);
    }
    return this.finish(t, a, 'accepted', 'OK', 'dentro del mandato y del techo del core', risk.evidence, risk.position_after);
  }

  private finish(
    t: string,
    a: Attempt,
    decision: GatewayDecision,
    code: GatewayCode,
    reason: string,
    evidence: Evidence = {},
    positionAfter?: number,
  ): GatewayOutcome {
    const n = this.attempts;
    const i = a.intent;
    const strategyId = this.mandate.strategy_id;
    const common = { created_at: t, schema_version: FINANCE_SCHEMA_VERSION, source: this.source };
    const decisionId = `dec-${strategyId}-${n}`;
    const gateway = { decision, code, reason, evidence };

    const record = {
      id: decisionId,
      ...common,
      strategy_id: strategyId,
      strategy_version: i?.strategy_version ?? '<desconocida>',
      hypothesis: i?.hypothesis ?? '<intent no válido>',
      signal: i?.signal ?? { name: '<desconocida>', value: 0 },
      probability: i?.probability ?? null,
      intent_id: i?.intent_id ?? null,
      intent_seq: i?.seq ?? null,
      snapshot_id: a.snapshot?.id ?? null,
      snapshot_hash: a.snapshot?.payload_hash ?? null,
      mandate_id: this.mandate.mandate_id,
      gateway,
    } as DecisionRecord;

    const accepted = decision === 'accepted' && i !== null;
    const core: TradeReceiptCore = {
      id: `rcpt-${strategyId}-${n}`,
      ...common,
      decision_id: decisionId,
      strategy_id: strategyId,
      intent: i ? { side: i.side, quantity: i.quantity, limit_price: i.limit_price } : null,
      gateway_decision: decision,
      order: accepted ? { order_id: `ord-${strategyId}-${n}`, side: i.side, quantity: i.quantity, price: i.limit_price, sent_at: t } : null,
      fill: null,
      costs: null,
      pnl: null,
      exposure_after: accepted ? (positionAfter ?? a.positionNow) : a.positionNow,
      prev_receipt_hash: this.lastReceiptHash,
    };
    const receipt = signTradeReceipt(core, this.keys);

    try {
      this.ledger.append('decision', decisionId, record);
      this.ledger.append('trade_receipt', receipt.id, receipt);
    } catch (e) {
      this.trip(`fallo del ledger: ${(e as Error).message}`, t);
      return { decision: 'blocked', code: 'LEDGER_FAILURE', reason: `no se pudo registrar el intento: ${(e as Error).message}`, evidence, decision_record: null, receipt: null };
    }

    this.attempts++;
    this.lastClockMs = Date.parse(t);
    this.lastReceiptHash = receipt.content_hash;
    if (i) {
      this.seenIntents.add(i.intent_id);
      this.lastSeq = Math.max(this.lastSeq ?? i.seq, i.seq);
    }
    if (accepted) this.acceptedAt.push(t);
    return { decision, code, reason, evidence, decision_record: record, receipt };
  }

  private trip(reason: string, at: string): void {
    if (this.kill.tripped) return;
    this.kill = { tripped: true, reason, at };
    try {
      this.ledger.append('kill_switch', 'kill_switch', { state: 'tripped', reason, at });
    } catch {
      // Enclavado en memoria aunque no se pueda registrar; al reiniciar, un ledger roto impide arrancar.
    }
  }

  private assertKeysWork(): void {
    try {
      const probe = signTradeReceipt(
        {
          id: 'probe', created_at: new Date(0).toISOString(), schema_version: FINANCE_SCHEMA_VERSION, source: 'probe',
          decision_id: 'probe', strategy_id: 'probe', intent: null, gateway_decision: 'blocked',
          order: null, fill: null, costs: null, pnl: null, exposure_after: 0, prev_receipt_hash: '',
        },
        this.keys,
      );
      if (!verifySignedTradeReceipt(probe, this.keys.publicKeyPem).valid) throw new Error('la firma no verifica');
    } catch (e) {
      throw new GatewayConfigError(`claves de firma inservibles: ${(e as Error).message}`);
    }
  }

  private rebuildFromLedger(): void {
    const check = this.ledger.verify();
    if (!check.valid) throw new FinanceLedgerCorruptError(check);
    for (const ev of this.ledger.read()) {
      const p = ev.payload as Record<string, any>;
      if (ev.kind === 'kill_switch') {
        this.kill = p.state === 'tripped' ? { tripped: true, reason: p.reason, at: p.at } : { tripped: false, reason: null, at: p.at };
        continue;
      }
      if (p?.strategy_id !== this.mandate.strategy_id) continue;
      if (ev.kind === 'decision') {
        this.attempts++;
        const ms = Date.parse(p.created_at);
        if (Number.isFinite(ms)) this.lastClockMs = Math.max(this.lastClockMs ?? ms, ms);
        if (typeof p.intent_id === 'string') this.seenIntents.add(p.intent_id);
        if (Number.isInteger(p.intent_seq)) this.lastSeq = Math.max(this.lastSeq ?? p.intent_seq, p.intent_seq);
        if (p.gateway?.decision === 'accepted') this.acceptedAt.push(p.created_at);
      } else if (ev.kind === 'trade_receipt') {
        this.lastReceiptHash = p.content_hash;
      }
    }
  }
}
