#!/usr/bin/env node
// oracle.mjs — the ORACLE test subject.
//
// It knows the answers: for the requested task it prints the bank's computed
// oracle_output (which compute_oracles.ts has already validated to PASS its
// grader). Used by the F0 regression to prove 30/30. It does NOT grade — it
// only emits output, exactly like a real subject would.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bankPath = process.env.SELLO_BANK
  ? path.resolve(process.env.SELLO_BANK)
  : path.resolve(__dirname, '../../../bank/pilot_agentic_v1.jsonl');

const taskId = process.env.SELLO_TASK_ID;
if (!taskId) { console.error('oracle: SELLO_TASK_ID not set'); process.exit(2); }

const lines = fs.readFileSync(bankPath, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
const task = lines.map((l) => JSON.parse(l)).find((t) => t.task_id === taskId);
if (!task) { console.error(`oracle: task ${taskId} not in bank`); process.exit(2); }
if (task.oracle_output === null || task.oracle_output === undefined) {
  console.error(`oracle: task ${taskId} has no computed oracle_output (run compute_oracles)`);
  process.exit(2);
}

// renderOracle: MUST stay byte-identical to renderOracle() in
// scripts/compute_oracles.ts. JSON object first (parseable), mandatory-action
// phrases follow as plain text so their literal quotes are not JSON-escaped.
function renderOracle(o) {
  const { _oracle_assertions, ...rest } = o;
  let out = JSON.stringify(rest);
  if (Array.isArray(_oracle_assertions) && _oracle_assertions.length) {
    out += '\n' + _oracle_assertions.join('\n');
  }
  return out;
}

process.stdout.write(renderOracle(task.oracle_output));
