import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';
import {
  CAPPED_FIELDS,
  FinanceLedger,
  FinanceLedgerCorruptError,
  GatewayConfigError,
  KILL_SWITCH_RESET_CONFIRMATION,
  OrderGateway,
  loadFinanceFixture,
  validateDecisionRecord,
  verifyFinanceLedgerFile,
  verifySignedTradeReceipt,
  type GatewayConfig,
  type OrderIntent,
  type PortfolioState,
  type RiskCaps,
  type SignedTradeReceipt,
} from '../domains/finance/index.js';

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};
const KEYS = keyPair();

const verified = loadFinanceFixture('market_snapshot_verified') as Record<string, unknown>;
const stale = loadFinanceFixture('market_snapshot_stale') as Record<string, unknown>;
const mandate = loadFinanceFixture('strategy_mandate_conservative') as Record<string, unknown>;
const caps = Object.fromEntries(CAPPED_FIELDS.map((k) => [k, k === 'max_drawdown' || k === 'max_depth_fraction' ? 1 : 1e12])) as RiskCaps;

let clock: string;
let file: string;
let portfolioState: PortfolioState;
let marketData: GatewayConfig['marketData'];

const ms = (iso: string, delta: number) => new Date(Date.parse(iso) + delta).toISOString();

beforeEach(() => {
  clock = '2026-01-15T12:00:01.000Z';
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'finance-gw-')), 'ledger.jsonl');
  portfolioState = { equity: 10_000, peak_equity: 10_000, realized_pnl_day: 0, realized_pnl_cycle: 0, positions: {} };
  // Snapshot fresco respecto al reloj actual.
  marketData = () => ({ ...verified, provider_ts: clock, received_ts: clock });
});

const config = (over: Partial<GatewayConfig> = {}): GatewayConfig => ({
  ledger: new FinanceLedger(file, () => clock),
  mandate,
  caps,
  keys: KEYS,
  marketData: (i) => marketData(i),
  portfolio: () => portfolioState,
  now: () => clock,
  ...over,
});

let seq = 0;
const intent = (over: Partial<OrderIntent> = {}): OrderIntent => {
  seq++;
  return {
    intent_id: `i-${seq}-${Math.random().toString(36).slice(2, 8)}`, seq, strategy_id: 'sma_cross', strategy_version: '1.0.0',
    instrument: 'BTC-USD-PERP', side: 'buy', quantity: 0.01, limit_price: null, stop_price: 41600, expected_slippage_bps: 1,
    created_at: clock, hypothesis: 'cruce de SMA', signal: { name: 'sma20_minus_sma50', value: 3.5 }, probability: null, ...over,
  };
};

const decisionsInLedger = () => new FinanceLedger(file).read().filter((e) => e.kind === 'decision');
const receiptsInLedger = () => new FinanceLedger(file).read().filter((e) => e.kind === 'trade_receipt').map((e) => e.payload as SignedTradeReceipt);

describe('finance F1 — arranque del gateway (fail-closed)', () => {
  it('no arranca con mandato inválido, techo incompleto, mandato por encima del techo o claves inservibles', () => {
    expect(() => new OrderGateway(config({ mandate: { ...mandate, venue: '' } }))).toThrow(GatewayConfigError);
    expect(() => new OrderGateway(config({ caps: { ...caps, max_drawdown: undefined } }))).toThrow(/techo de riesgo inválido/);
    expect(() => new OrderGateway(config({ caps: { ...caps, max_loss_per_trade: 5 } }))).toThrow(/supera el techo del core en: max_loss_per_trade/);
    expect(() => new OrderGateway(config({ keys: { publicKeyPem: keyPair().publicKeyPem, privateKeyPem: KEYS.privateKeyPem } }))).toThrow(/claves de firma/);
  });

  it('no arranca sobre un ledger corrupto', () => {
    const gw = new OrderGateway(config());
    gw.strategyPort().submit(intent());
    const text = fs.readFileSync(file, 'utf-8').replace('"quantity":0.01', '"quantity":5');
    fs.writeFileSync(file, text);
    expect(() => new OrderGateway(config())).toThrow(FinanceLedgerCorruptError);
  });
});

describe('finance F1 — camino aceptado y registro de cada intento', () => {
  it('acepta, firma el recibo, lo encadena al anterior y deja decisión + recibo en el ledger', () => {
    const port = new OrderGateway(config()).strategyPort();
    const a = port.submit(intent());
    expect(a).toMatchObject({ decision: 'accepted', code: 'OK' });
    expect(a.receipt!.order).not.toBeNull();
    expect(a.receipt!.fill).toBeNull();
    expect(verifySignedTradeReceipt(a.receipt!, KEYS.publicKeyPem)).toEqual({ valid: true, reason: 'ok' });

    const b = port.submit(intent());
    expect(b.receipt!.prev_receipt_hash).toBe(a.receipt!.content_hash);
    expect(verifyFinanceLedgerFile(file)).toMatchObject({ valid: true, entries: 4 });
  });

  it('cada intento —aceptado, rechazado o bloqueado— produce una decisión válida y un recibo firmado', () => {
    const port = new OrderGateway(config()).strategyPort();
    port.submit(intent());
    port.submit(intent({ stop_price: 50_000 }));
    port.submit({ basura: true });
    port.submit(intent({ expected_slippage_bps: 50 }));
    marketData = () => stale;
    port.submit(intent());

    const decisions = decisionsInLedger();
    expect(decisions.map((d) => (d.payload as any).gateway.code)).toEqual(['OK', 'INVALID_STOP', 'UNKNOWN_FIELDS', 'MAX_SLIPPAGE', 'SNAPSHOT_QUALITY']);
    for (const d of decisions) expect(validateDecisionRecord(d.payload).ok).toBe(true);
    const receipts = receiptsInLedger();
    expect(receipts).toHaveLength(5);
    for (const r of receipts) expect(verifySignedTradeReceipt(r, KEYS.publicKeyPem).valid).toBe(true);
    for (const r of receipts.slice(1)) expect(r.order).toBeNull();
    expect(receipts[2].intent).toBeNull();
  });
});

describe('finance F1 — la estrategia no puede tocar el core', () => {
  it('la estrategia solo recibe submit, en un objeto congelado', () => {
    const port = new OrderGateway(config()).strategyPort();
    expect(Object.keys(port)).toEqual(['submit']);
    expect(Object.isFrozen(port)).toBe(true);
  });

  it('un intent que intenta colar límites o un mandato propio se bloquea y el mandato no cambia', () => {
    const gw = new OrderGateway(config());
    const r = gw.strategyPort().submit({ ...intent(), max_loss_per_trade: 1e9, mandate: { max_drawdown: 1 } });
    expect(r).toMatchObject({ decision: 'blocked', code: 'UNKNOWN_FIELDS' });
    expect(gw.mandate.max_loss_per_trade).toBe(10);
  });

  it('el mandato y el techo quedan congelados en profundidad', () => {
    const gw = new OrderGateway(config());
    expect(() => { (gw.mandate as any).max_loss_per_trade = 1e9; }).toThrow(TypeError);
    expect(() => { (gw.mandate.factors[0] as any).max_exposure = 1e9; }).toThrow(TypeError);
    expect(() => { (gw.caps as any).max_drawdown = 1; }).toThrow(TypeError);
  });

  it('cambiar el objeto de mandato original después de arrancar no afecta al gateway', () => {
    const own = structuredClone(mandate);
    const gw = new OrderGateway(config({ mandate: own }));
    (own as any).max_loss_per_trade = 1e9;
    expect(gw.mandate.max_loss_per_trade).toBe(10);
  });

  it('un gateway solo atiende a la estrategia de su mandato', () => {
    const r = new OrderGateway(config()).strategyPort().submit(intent({ strategy_id: 'otra' }));
    expect(r).toMatchObject({ decision: 'blocked', code: 'STRATEGY_MISMATCH' });
  });
});

describe('finance F1 — duplicación, reordenación y reloj', () => {
  it('un intent repetido se rechaza', () => {
    const port = new OrderGateway(config()).strategyPort();
    const i = intent();
    expect(port.submit(i).decision).toBe('accepted');
    expect(port.submit(i)).toMatchObject({ decision: 'rejected', code: 'DUPLICATE_INTENT' });
  });

  it('un mensaje con secuencia vieja o repetida se rechaza', () => {
    const port = new OrderGateway(config()).strategyPort();
    const first = intent();
    const second = intent();
    expect(port.submit(second).decision).toBe('accepted');
    expect(port.submit(first)).toMatchObject({ decision: 'rejected', code: 'OUT_OF_ORDER' });
    expect(port.submit({ ...intent(), seq: second.seq })).toMatchObject({ code: 'OUT_OF_ORDER' });
  });

  it('desfase de reloj con el intent: en el límite pasa, por encima se bloquea', () => {
    const port = new OrderGateway(config()).strategyPort();
    expect(port.submit(intent({ created_at: ms(clock, -2000) })).decision).toBe('accepted');
    expect(port.submit(intent({ created_at: ms(clock, -2001) }))).toMatchObject({ decision: 'blocked', code: 'CLOCK_SKEW' });
  });

  it('si el reloj del gateway retrocede, enclava el kill switch y no emite recibo', () => {
    const gw = new OrderGateway(config());
    const port = gw.strategyPort();
    port.submit(intent());
    clock = ms(clock, -1000);
    const r = port.submit(intent());
    expect(r).toMatchObject({ decision: 'blocked', code: 'CLOCK_REGRESSION', decision_record: null, receipt: null });
    expect(gw.killSwitch().tripped).toBe(true);
    clock = ms(clock, 5000);
    expect(port.submit(intent())).toMatchObject({ code: 'KILL_SWITCH' });
  });

  it('un reloj inválido también enclava', () => {
    const gw = new OrderGateway(config());
    clock = 'no-es-una-fecha';
    expect(gw.strategyPort().submit(intent())).toMatchObject({ code: 'INVALID_CLOCK' });
    expect(gw.killSwitch().tripped).toBe(true);
  });
});

describe('finance F1 — datos y estado', () => {
  it('datos stale, viejos o de otro venue bloquean', () => {
    const port = new OrderGateway(config()).strategyPort();
    marketData = () => stale;
    expect(port.submit(intent())).toMatchObject({ code: 'SNAPSHOT_QUALITY' });
    marketData = () => ({ ...verified, provider_ts: ms(clock, -5001), received_ts: ms(clock, -5000) });
    expect(port.submit(intent())).toMatchObject({ code: 'SNAPSHOT_STALE' });
    marketData = () => ({ ...verified, venue: 'paradex', provider_ts: clock, received_ts: clock });
    expect(port.submit(intent())).toMatchObject({ code: 'SNAPSHOT_VENUE_MISMATCH' });
  });

  it('si fallan los datos de mercado o el estado de cartera, se bloquea', () => {
    const port = new OrderGateway(config()).strategyPort();
    marketData = () => { throw new Error('timeout'); };
    expect(port.submit(intent())).toMatchObject({ decision: 'blocked', code: 'MARKET_DATA_FAILURE' });
    marketData = () => ({ ...verified, provider_ts: clock, received_ts: clock });
    portfolioState = { ...portfolioState, equity: Number.NaN };
    expect(port.submit(intent())).toMatchObject({ decision: 'blocked', code: 'UNKNOWN_STATE' });
    const gw2 = new OrderGateway(config({ portfolio: () => { throw new Error('sin conexión'); } }));
    expect(gw2.strategyPort().submit(intent())).toMatchObject({ decision: 'blocked', code: 'UNKNOWN_STATE' });
  });

  it('el gateway cuenta él mismo las órdenes del día y reinicia el contador al cambiar de día UTC', () => {
    const port = new OrderGateway(config({ mandate: { ...mandate, max_orders_per_day: 2 } })).strategyPort();
    expect(port.submit(intent()).decision).toBe('accepted');
    port.submit(intent({ stop_price: 50_000 })); // rechazada: no cuenta como orden
    expect(port.submit(intent()).decision).toBe('accepted');
    expect(port.submit(intent())).toMatchObject({ code: 'MAX_ORDERS_PER_DAY' });
    clock = '2026-01-16T00:00:00.500Z';
    expect(port.submit(intent()).decision).toBe('accepted');
  });
});

describe('finance F1 — kill switch', () => {
  it('enclavado durante una secuencia abierta: bloquea lo siguiente, pero lo sigue registrando', () => {
    const gw = new OrderGateway(config());
    const port = gw.strategyPort();
    expect(port.submit(intent()).decision).toBe('accepted');
    gw.tripKillSwitch('operador: prueba');
    const r = port.submit(intent());
    expect(r).toMatchObject({ decision: 'blocked', code: 'KILL_SWITCH' });
    expect(r.receipt).not.toBeNull();
    expect(decisionsInLedger()).toHaveLength(2);
  });

  it('solo se desenclava con un reset explícito del operador, que queda registrado', () => {
    const gw = new OrderGateway(config());
    gw.tripKillSwitch('prueba');
    expect(() => gw.resetKillSwitch({ operator: 'angel', reason: 'revisado', confirm: 'si' })).toThrow(/reset rechazado/);
    expect(() => gw.resetKillSwitch({ operator: '', reason: 'revisado', confirm: KILL_SWITCH_RESET_CONFIRMATION })).toThrow();
    expect(gw.killSwitch().tripped).toBe(true);
    gw.resetKillSwitch({ operator: 'angel', reason: 'revisado', confirm: KILL_SWITCH_RESET_CONFIRMATION });
    expect(gw.killSwitch().tripped).toBe(false);
    const events = new FinanceLedger(file).read().filter((e) => e.kind === 'kill_switch').map((e) => (e.payload as any).state);
    expect(events).toEqual(['tripped', 'reset']);
    expect(gw.strategyPort().submit(intent()).decision).toBe('accepted');
  });

  it('un drawdown agotado enclava el kill switch, que sigue enclavado aunque la cartera se recupere', () => {
    const gw = new OrderGateway(config());
    const port = gw.strategyPort();
    portfolioState = { ...portfolioState, equity: 9_500 };
    expect(port.submit(intent())).toMatchObject({ decision: 'blocked', code: 'MAX_DRAWDOWN' });
    expect(gw.killSwitch().tripped).toBe(true);
    portfolioState = { ...portfolioState, equity: 10_000 };
    expect(port.submit(intent())).toMatchObject({ code: 'KILL_SWITCH' });
  });

  it('el kill switch enclavado sobrevive a un reinicio', () => {
    new OrderGateway(config()).tripKillSwitch('antes del reinicio');
    const again = new OrderGateway(config());
    expect(again.killSwitch()).toMatchObject({ tripped: true, reason: 'antes del reinicio' });
    expect(again.strategyPort().submit(intent())).toMatchObject({ code: 'KILL_SWITCH' });
  });
});

describe('finance F1 — reinicio y fallo del ledger', () => {
  it('tras reiniciar recuerda intents vistos, la última secuencia y la cadena de recibos', () => {
    const port = new OrderGateway(config()).strategyPort();
    const i = intent();
    const first = port.submit(i);
    const port2 = new OrderGateway(config()).strategyPort();
    expect(port2.submit(i)).toMatchObject({ code: 'DUPLICATE_INTENT' });
    expect(port2.submit({ ...intent(), seq: i.seq })).toMatchObject({ code: 'OUT_OF_ORDER' });
    const receipts = receiptsInLedger();
    expect(receipts[1].prev_receipt_hash).toBe(first.receipt!.content_hash);
  });

  it('si el ledger falla al registrar: se bloquea, se enclava y no se sigue', () => {
    class FlakyLedger extends FinanceLedger {
      failing = false;
      override append<P>(...args: Parameters<FinanceLedger['append']>) {
        if (this.failing) throw new Error('disco lleno');
        return super.append(args[0], args[1], args[2] as P);
      }
    }
    const ledger = new FlakyLedger(file, () => clock);
    const gw = new OrderGateway(config({ ledger }));
    ledger.failing = true;
    const r = gw.strategyPort().submit(intent());
    expect(r).toMatchObject({ decision: 'blocked', code: 'LEDGER_FAILURE', decision_record: null, receipt: null });
    expect(gw.killSwitch().tripped).toBe(true);
    ledger.failing = false;
    expect(gw.strategyPort().submit(intent())).toMatchObject({ code: 'KILL_SWITCH' });
  });
});
