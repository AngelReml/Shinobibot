// D.4 — MissionLedger: hash chain SHA256 de cada mision completada.
// Replica el patron del forensic ledger de OpenGravity. Convierte a Shinobi
// en un sistema auditable con cadena criptografica intacta.
//
// Storage: ledger/chain.jsonl (append-only, una linea por entry).
// Cada entry incluye prev_hash + sha256(serialized self_without_self_hash).

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface LedgerEntry {
  mission_id: string;
  timestamp: string;            // ISO
  input_hash: string;           // sha256(input string)
  output_hash: string;          // sha256(output string)
  model_calls: number;
  total_cost: number;
  prev_hash: string;            // hex of previous self_hash, "" for first entry
  self_hash: string;            // sha256 of every other field, see canonicalize()
}

export interface RecordInput {
  mission_id: string;
  input: string;                // raw input bytes (URL, prompt, file contents…)
  output: string;               // raw output bytes (markdown, JSON…)
  model_calls?: number;
  total_cost?: number;
  timestamp?: string;
}

const LEDGER_FILE_NAME = 'chain.jsonl';

function sha256Hex(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

function canonicalize(entry: Omit<LedgerEntry, 'self_hash'>): string {
  // Stable key order is critical so the hash recomputes identically across
  // verifications. Use a deterministic JSON.stringify with sorted keys.
  const orderedKeys = ['mission_id', 'timestamp', 'input_hash', 'output_hash', 'model_calls', 'total_cost', 'prev_hash'] as const;
  const obj: Record<string, unknown> = {};
  for (const k of orderedKeys) obj[k] = (entry as any)[k];
  return JSON.stringify(obj);
}

export class MissionLedger {
  private file: string;

  constructor(opts: { ledgerDir?: string } = {}) {
    const dir = opts.ledgerDir ?? path.join(process.cwd(), 'ledger');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, LEDGER_FILE_NAME);
  }

  /** Append a new entry to the chain. Returns the new self_hash. */
  record(input: RecordInput): LedgerEntry {
    const prev = this.tail();
    const partial: Omit<LedgerEntry, 'self_hash'> = {
      mission_id: input.mission_id,
      timestamp: input.timestamp ?? new Date().toISOString(),
      input_hash: sha256Hex(input.input),
      output_hash: sha256Hex(input.output),
      model_calls: input.model_calls ?? 0,
      total_cost: input.total_cost ?? 0,
      prev_hash: prev?.self_hash ?? '',
    };
    const self_hash = sha256Hex(canonicalize(partial));
    const entry: LedgerEntry = { ...partial, self_hash };
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }

  list(): LedgerEntry[] {
    if (!fs.existsSync(this.file)) return [];
    const txt = fs.readFileSync(this.file, 'utf-8');
    return txt.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as LedgerEntry);
  }

  tail(): LedgerEntry | undefined {
    const all = this.list();
    return all[all.length - 1];
  }

  count(): number { return this.list().length; }

  /**
   * Walk the entire chain. Each entry must:
   *   1. Recompute self_hash exactly (no field tampering).
   *   2. Reference the prior entry's self_hash via prev_hash.
   * Returns ok=true with no breakages, or ok=false listing every break.
   */
  verify(): { ok: boolean; entries: number; breakages: { index: number; reason: string }[] } {
    const all = this.list();
    const breakages: { index: number; reason: string }[] = [];
    let prevHash = '';
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const recomputed = sha256Hex(canonicalize({
        mission_id: e.mission_id,
        timestamp: e.timestamp,
        input_hash: e.input_hash,
        output_hash: e.output_hash,
        model_calls: e.model_calls,
        total_cost: e.total_cost,
        prev_hash: e.prev_hash,
      }));
      if (recomputed !== e.self_hash) breakages.push({ index: i, reason: `self_hash mismatch (recomputed=${recomputed.slice(0, 12)}…, stored=${e.self_hash.slice(0, 12)}…)` });
      if (e.prev_hash !== prevHash) breakages.push({ index: i, reason: `prev_hash break (expected ${prevHash || '<empty>'}, got ${e.prev_hash || '<empty>'})` });
      prevHash = e.self_hash;
    }
    return { ok: breakages.length === 0, entries: all.length, breakages };
  }

  /** Export chain as a single JSON document (commiteable). */
  export(): { entries: LedgerEntry[]; head: string; count: number } {
    const entries = this.list();
    return {
      entries,
      head: entries[entries.length - 1]?.self_hash ?? '',
      count: entries.length,
    };
  }

  /** Path of the on-disk chain file (for debugging). */
  get path(): string { return this.file; }
}
