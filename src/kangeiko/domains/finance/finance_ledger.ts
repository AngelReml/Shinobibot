// Ledger financiero append-only con hash chain: guarda el payload completo para poder reconstruir cada decisión.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { buildChain, toLines } from '../../../audit/audit_chain.js';
import { verifyFinanceLedgerText, type FinanceLedgerVerification } from './finance_ledger_verifier.js';

export type FinanceLedgerKind =
  | 'market_snapshot'
  | 'strategy_spec'
  | 'strategy_mandate'
  | 'decision'
  | 'trade_receipt'
  | 'strategy_transition';

export interface FinanceLedgerEvent<P = unknown> {
  readonly seq: number;
  readonly kind: FinanceLedgerKind;
  readonly entity_id: string;
  readonly recorded_at: string;
  readonly payload: P;
  readonly prevHash: string;
  readonly chainHash: string;
}

export class FinanceLedgerCorruptError extends Error {
  constructor(readonly verification: FinanceLedgerVerification) {
    super(`ledger financiero corrupto (${verification.reason} en ${verification.brokenAt ?? '?'}): no se añade nada`);
    this.name = 'FinanceLedgerCorruptError';
  }
}

export class FinanceLedger {
  /** La ruta es obligatoria: el dominio nunca escribe en un ledger por defecto dentro del repo. */
  constructor(
    readonly file: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  append<P>(kind: FinanceLedgerKind, entity_id: string, payload: P): FinanceLedgerEvent<P> {
    // Fail-closed: si la cadena existente no verifica, no se encadena nada encima.
    const check = verifyFinanceLedgerText(this.readText());
    if (!check.valid) throw new FinanceLedgerCorruptError(check);
    // prevHash y chainHash van al final: verifyChain recompone el contenido quitándolos y conservando el orden.
    const body = { seq: check.entries, kind, entity_id, recorded_at: this.now(), payload };
    const chainHash = buildChain([JSON.stringify(body)], check.root)[0].chainHash;
    const event: FinanceLedgerEvent<P> = { ...body, prevHash: check.root, chainHash };
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(event) + '\n');
    return event;
  }

  read(): FinanceLedgerEvent[] {
    return toLines(this.readText()).map((l) => JSON.parse(l) as FinanceLedgerEvent);
  }

  verify(expected?: { root?: string; entries?: number }): FinanceLedgerVerification {
    return verifyFinanceLedgerText(this.readText(), expected);
  }

  private readText(): string {
    return existsSync(this.file) ? readFileSync(this.file, 'utf-8') : '';
  }
}
