/**
 * recorder.ts — append-only, hash-chained ledger of PoBI verdicts.
 *
 * PROVENANCE: adapted from
 *   OpenGravity/attestation-layer/src/forensic/recorder.mjs
 * Kept: genesis anchor, cross-process O_EXCL advisory lock, verifyLedger.
 * Changed (per CONTRACT §2): the chain links on the verdict's `this_hash`
 * (a signed per-record hash), not on sha256 of the previous raw line. Each
 * ledger line is the index entry; the full signed verdict lives in runs/.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface LedgerEntry {
  task_id: string;
  verdict: string;
  this_hash: string;   // "sha256:..." of the signed verdict record
  prev_hash: string;   // previous entry's this_hash, or "genesis"
  recorded_utc: string;
}

function sleepMs(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ }
}

/**
 * Cross-process advisory lock around read-prev + append. Atomic O_EXCL create
 * is the mutex; stale locks (>30s, crashed holder) are stolen. (AUDIT FIX #8
 * from the source recorder.)
 */
function withLedgerLock<T>(ledgerPath: string, fn: () => T): T {
  const lock = ledgerPath + '.lock';
  const start = Date.now();
  while (Date.now() - start < 5000) {
    let fd: number;
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (e: any) {
      if (e.code === 'EEXIST') {
        try {
          const st = fs.statSync(lock);
          if (Date.now() - st.mtimeMs > 30000) fs.unlinkSync(lock);
        } catch { /* race ok */ }
        sleepMs(10);
        continue;
      }
      // FS forbids lock files entirely → degrade to unlocked (single-process safe).
      return fn();
    }
    try { return fn(); }
    finally {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  console.error('[recorder] ledger lock timeout, proceeding unlocked:', lock);
  return fn();
}

/** this_hash of the last ledger entry, or "genesis" if empty/missing. */
export function ledgerHead(ledgerPath: string): string {
  if (!fs.existsSync(ledgerPath)) return 'genesis';
  const content = fs.readFileSync(ledgerPath, 'utf-8').trimEnd();
  if (!content) return 'genesis';
  const lines = content.split('\n');
  const last = JSON.parse(lines[lines.length - 1]) as LedgerEntry;
  return last.this_hash;
}

/** Append one entry. The prev-hash read + append is the only serialized section. */
export function append(ledgerPath: string, partial: Omit<LedgerEntry, 'prev_hash'>): LedgerEntry {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  return withLedgerLock(ledgerPath, () => {
    const prev = ledgerHead(ledgerPath);
    const entry: LedgerEntry = { ...partial, prev_hash: prev };
    fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  });
}

/**
 * Read head + build (via fn) + append, all under one lock. `fn(prev)` builds the
 * full entry given the current head; because the PoBI verdict's this_hash binds
 * prev_hash, the builder must sign using exactly the prev passed here. This keeps
 * verdict.integrity.prev_hash and the ledger entry.prev_hash identical even under
 * concurrent writers.
 */
export function appendBuilt(ledgerPath: string, fn: (prev: string) => LedgerEntry): LedgerEntry {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  return withLedgerLock(ledgerPath, () => {
    const prev = ledgerHead(ledgerPath);
    const entry = fn(prev);
    fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  });
}

/** Verify the chain: entry[i].prev_hash == entry[i-1].this_hash (genesis-anchored). */
export function verifyLedger(ledgerPath: string): { ok: boolean; reason?: string; entries?: number } {
  if (!fs.existsSync(ledgerPath)) return { ok: false, reason: 'ledger not found' };
  const lines = fs.readFileSync(ledgerPath, 'utf-8').trimEnd().split('\n').filter(Boolean);
  let prev = 'genesis';
  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]) as LedgerEntry;
    if (entry.prev_hash !== prev) {
      return { ok: false, reason: `broken chain at line ${i + 1}: expected prev ${prev}, got ${entry.prev_hash}` };
    }
    prev = entry.this_hash;
  }
  return { ok: true, entries: lines.length };
}

/** Most recent ledger entry for a task_id, or null. */
export function lastEntryForTask(ledgerPath: string, taskId: string): LedgerEntry | null {
  if (!fs.existsSync(ledgerPath)) return null;
  const lines = fs.readFileSync(ledgerPath, 'utf-8').trimEnd().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]) as LedgerEntry;
    if (entry.task_id === taskId) return entry;
  }
  return null;
}
