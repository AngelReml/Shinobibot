import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GENESIS, buildChain } from '../../audit/audit_chain.js';
import {
  FINANCE_LEDGER_GENESIS,
  FinanceLedger,
  FinanceLedgerCorruptError,
  buildTradeReceipt,
  checkOrderPreconditions,
  loadFinanceFixture,
  verifyFinanceLedgerFile,
  verifyFinanceLedgerText,
} from '../domains/finance/index.js';

let file: string;
let ledger: FinanceLedger;
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 0, 15, 12, 0, tick++)).toISOString();

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'finance-ledger-')), 'ledger.jsonl');
  tick = 0;
  ledger = new FinanceLedger(file, clock);
});

const lines = () => fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
const writeLines = (ls: string[]) => fs.writeFileSync(file, ls.join('\n') + '\n');

function seedThree() {
  ledger.append('market_snapshot', 'snap-1', loadFinanceFixture('market_snapshot_verified'));
  ledger.append('strategy_mandate', 'mandate-1', loadFinanceFixture('strategy_mandate_conservative'));
  ledger.append('decision', 'decision-1', loadFinanceFixture('decision_record_blocked'));
}

describe('finance F0 — ledger append-only encadenado', () => {
  it('encadena cada evento con el anterior, guarda el payload completo y verifica', () => {
    seedThree();
    const events = ledger.read();
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events[0].prevHash).toBe(FINANCE_LEDGER_GENESIS);
    expect(events[1].prevHash).toBe(events[0].chainHash);
    expect(events[2].prevHash).toBe(events[1].chainHash);
    expect(events[0].payload).toEqual(loadFinanceFixture('market_snapshot_verified'));
    const v = ledger.verify();
    expect(v).toMatchObject({ valid: true, entries: 3, root: events[2].chainHash });
  });

  it('un ledger vacío o inexistente verifica con raíz = génesis', () => {
    expect(ledger.verify()).toMatchObject({ valid: true, entries: 0, root: FINANCE_LEDGER_GENESIS });
  });

  it('el mismo reloj y los mismos eventos producen exactamente la misma raíz', () => {
    seedThree();
    const rootA = ledger.verify().root;
    const fileB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'finance-ledger-')), 'ledger.jsonl');
    tick = 0;
    ledger = new FinanceLedger(fileB, clock);
    seedThree();
    expect(ledger.verify().root).toBe(rootA);
  });
});

describe('finance F0 — un evento modificado rompe la verificación (verificador independiente)', () => {
  it('detecta la edición de un solo carácter en el payload, en el índice exacto', () => {
    seedThree();
    const ls = lines();
    ls[1] = ls[1].replace('"max_loss_per_trade":10', '"max_loss_per_trade":99');
    expect(ls[1]).toContain('99');
    writeLines(ls);
    expect(verifyFinanceLedgerFile(file)).toMatchObject({ valid: false, brokenAt: 1, reason: 'tampered_line' });
  });

  it('detecta el borrado de un evento intermedio', () => {
    seedThree();
    const ls = lines();
    writeLines([ls[0], ls[2]]);
    expect(verifyFinanceLedgerFile(file)).toMatchObject({ valid: false, brokenAt: 1 });
  });

  it('detecta la reordenación de eventos', () => {
    seedThree();
    const ls = lines();
    writeLines([ls[1], ls[0], ls[2]]);
    expect(verifyFinanceLedgerFile(file)).toMatchObject({ valid: false, brokenAt: 0 });
  });

  it('detecta una línea sin campos de cadena (inyectada fuera del escritor)', () => {
    seedThree();
    writeLines([...lines(), JSON.stringify({ seq: 3, kind: 'decision', entity_id: 'x', payload: {} })]);
    expect(verifyFinanceLedgerFile(file)).toMatchObject({ valid: false, brokenAt: 3, reason: 'missing_chain' });
  });

  it('borrar los últimos eventos solo se detecta contra un ancla externa (raíz o número de entradas)', () => {
    seedThree();
    const anchor = ledger.verify();
    writeLines(lines().slice(0, 2));
    expect(verifyFinanceLedgerFile(file).valid).toBe(true);
    expect(verifyFinanceLedgerFile(file, { root: anchor.root })).toMatchObject({ valid: false, reason: 'root_mismatch' });
    expect(verifyFinanceLedgerFile(file, { entries: anchor.entries })).toMatchObject({ valid: false, reason: 'count_mismatch' });
  });

  it('una línea encadenada con la génesis del audit general no verifica como ledger financiero', () => {
    const body = { seq: 0, kind: 'decision', entity_id: 'x', recorded_at: '2026-01-15T12:00:00.000Z', payload: {} };
    const chainHash = buildChain([JSON.stringify(body)], GENESIS)[0].chainHash;
    const text = JSON.stringify({ ...body, prevHash: GENESIS, chainHash }) + '\n';
    expect(verifyFinanceLedgerText(text)).toMatchObject({ valid: false, brokenAt: 0 });
  });

  it('un fichero ilegible no verifica', () => {
    expect(verifyFinanceLedgerFile(path.join(os.tmpdir(), 'no-existe', 'ledger.jsonl'))).toMatchObject({ valid: false, reason: 'unreadable' });
  });

  it('el verificador no depende del escritor del ledger', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('../domains/finance/finance_ledger_verifier.ts', import.meta.url)), 'utf-8');
    expect(src).not.toMatch(/from '\.\/finance_ledger\.js'/);
  });
});

describe('finance F0 — fallo del ledger: bloquear, no continuar', () => {
  it('no añade nada encima de una cadena corrupta y deja el fichero intacto', () => {
    seedThree();
    const ls = lines();
    ls[0] = ls[0].replace('42000.5', '42000.6');
    writeLines(ls);
    const before = fs.readFileSync(file, 'utf-8');
    expect(() => ledger.append('decision', 'decision-2', {})).toThrow(FinanceLedgerCorruptError);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });
});

describe('finance F0 — cañería completa sin red ni credenciales', () => {
  it('snapshot → mandato → precondiciones → decisión → recibo → ledger → verificación independiente', () => {
    const snapshot = loadFinanceFixture('market_snapshot_verified');
    const mandate = loadFinanceFixture('strategy_mandate_conservative');
    const pre = checkOrderPreconditions({ strategy_id: 'sma_cross', instrument: 'BTC-USD-PERP', snapshot, mandate, now: '2026-01-15T12:00:01.000Z' });
    expect(pre.ok).toBe(true);
    if (!pre.ok) return;

    ledger.append('market_snapshot', pre.snapshot.id, pre.snapshot);
    ledger.append('strategy_mandate', pre.mandate.mandate_id, pre.mandate);
    const decision = {
      id: 'decision-accepted-1', created_at: '2026-01-15T12:00:01.000Z', schema_version: 1 as const, source: 'test',
      strategy_id: 'sma_cross', strategy_version: '1.0.0', hypothesis: 'cruce de SMA', signal: { name: 'sma20_minus_sma50', value: 3.5 },
      probability: null, snapshot_id: pre.snapshot.id, snapshot_hash: pre.snapshot.payload_hash, mandate_id: pre.mandate.mandate_id,
      gateway: { decision: 'accepted' as const, code: 'OK' as const, reason: 'precondiciones cumplidas' },
    };
    ledger.append('decision', decision.id, decision);
    const receipt = buildTradeReceipt({
      id: 'receipt-1', created_at: '2026-01-15T12:00:02.000Z', schema_version: 1, source: 'paper:fixture',
      decision_id: decision.id, strategy_id: 'sma_cross',
      intent: { side: 'buy', quantity: 0.01, limit_price: null },
      gateway_decision: 'accepted',
      order: { order_id: 'o-1', side: 'buy', quantity: 0.01, price: null, sent_at: '2026-01-15T12:00:01.500Z' },
      fill: { quantity: 0.01, price: 42002, filled_at: '2026-01-15T12:00:02.000Z', partial: false },
      costs: { liquidity: 'taker', fees: 0.21, funding: 0, slippage_expected_bps: 1, slippage_real_bps: 0.24 },
      pnl: null,
      exposure_after: 420.02,
      prev_receipt_hash: '',
    });
    ledger.append('trade_receipt', receipt.id, receipt);

    const anchor = ledger.verify();
    expect(anchor).toMatchObject({ valid: true, entries: 4 });
    expect(verifyFinanceLedgerFile(file, { root: anchor.root, entries: 4 }).valid).toBe(true);
    expect(ledger.read()[3].payload).toEqual(receipt);
  });
});
