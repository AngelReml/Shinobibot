/**
 * core/paths.ts — resolved runtime paths (all overridable via env).
 * Runtime artifact dirs (evidence/, runs/, ledger/, keys/) are gitignored.
 */

import path from 'node:path';

const root = process.cwd();

export const PATHS = {
  bank: process.env.SELLO_BANK ? path.resolve(process.env.SELLO_BANK) : path.resolve(root, 'bank/pilot_agentic_v1.jsonl'),
  keysDir: process.env.SELLO_KEYS_DIR ? path.resolve(process.env.SELLO_KEYS_DIR) : path.resolve(root, 'keys'),
  evidenceDir: path.resolve(root, 'evidence'),
  runsDir: path.resolve(root, 'runs'),
  ledger: path.resolve(root, 'ledger/verdicts.jsonl'),
};

export const ADAPTER_TIMEOUT_MS = process.env.SELLO_ADAPTER_TIMEOUT_MS
  ? Number(process.env.SELLO_ADAPTER_TIMEOUT_MS)
  : 30000;
