// Verificador independiente del ledger financiero: solo necesita el texto JSONL y las primitivas puras de audit_chain.
// No importa el escritor (finance_ledger.ts), así que un tercero puede verificar sin confiar en él.

import { readFileSync } from 'fs';
import { toLines, verifyChain } from '../../../audit/audit_chain.js';

/** Génesis propia: una línea del audit general nunca verifica como evento financiero. */
export const FINANCE_LEDGER_GENESIS = 'SHINOBI_FINANCE_LEDGER_GENESIS_v1';

export interface FinanceLedgerVerification {
  readonly valid: boolean;
  readonly entries: number;
  /** chainHash del último evento válido (o la génesis si el ledger está vacío). */
  readonly root: string;
  readonly brokenAt?: number;
  readonly reason: 'ok' | 'tampered_line' | 'missing_chain' | 'root_mismatch' | 'count_mismatch' | 'unreadable';
}

/**
 * Sin `expected`, detecta edición, inserción, borrado intermedio y reordenación.
 * Borrar las últimas líneas solo se detecta contra un ancla externa (`expected.root` o `expected.entries`).
 */
export function verifyFinanceLedgerText(text: string, expected?: { root?: string; entries?: number }): FinanceLedgerVerification {
  const lines = toLines(text);
  const chain = verifyChain(lines, undefined, FINANCE_LEDGER_GENESIS);
  if (!chain.valid) {
    const reason = chain.reason === 'missing_chain' ? 'missing_chain' : 'tampered_line';
    return { valid: false, entries: lines.length, root: chain.root, brokenAt: chain.brokenAt, reason };
  }
  if (expected?.entries !== undefined && expected.entries !== lines.length) {
    return { valid: false, entries: lines.length, root: chain.root, reason: 'count_mismatch' };
  }
  if (expected?.root !== undefined && expected.root !== chain.root) {
    return { valid: false, entries: lines.length, root: chain.root, reason: 'root_mismatch' };
  }
  return { valid: true, entries: lines.length, root: chain.root, reason: 'ok' };
}

export function verifyFinanceLedgerFile(file: string, expected?: { root?: string; entries?: number }): FinanceLedgerVerification {
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return { valid: false, entries: 0, root: FINANCE_LEDGER_GENESIS, reason: 'unreadable' };
  }
  return verifyFinanceLedgerText(text, expected);
}
