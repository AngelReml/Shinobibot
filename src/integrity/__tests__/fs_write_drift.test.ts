import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCritical } from '../../security/approval.js';

/**
 * DRIFT GUARD (C7). The certified fs.write.v1 skill encodes the protected-path
 * policy; the live runtime uses Shinobi's approval.classifyCritical for the SAME
 * decision (one policy). This test pins them: for every path in the certified
 * bank, approval's classification must agree with the skill's oracle. If
 * CRITICAL_PATH_PATTERNS drifts from the certified policy, this BREAKS.
 */
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'certified', 'fs.write.v1');
const bank = fs.readFileSync(path.join(dir, 'bank.jsonl'), 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

describe('drift guard — approval policy == certified fs.write.v1 oracle', () => {
  it('classifyCritical agrees with the skill oracle on every bank path', () => {
    expect(bank.length).toBeGreaterThan(0);
    for (const task of bank) {
      const p = task.input.scenario.path;
      const expectedAllow = task.oracle_output.allow as boolean;
      const protectedByApproval = classifyCritical('write_file', { path: p }).destructive;
      expect(!protectedByApproval).toBe(expectedAllow);
    }
  });
});
