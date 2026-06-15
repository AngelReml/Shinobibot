import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DirCageSandbox, runTrial, type CageExecutor } from '../sandbox/revertible.js';
import type { Affordance } from '../types.js';

/**
 * S-04 GATE — the cage that enables everything. A destructive action runs INSIDE
 * the cage; revert restores it COMPLETELY; data marked "real" is never touched;
 * an external_effect action is documented but NEVER fired.
 *
 * Deterministic injected executor (interprets "delete <f>" / "write <f> <c>") so
 * the gate is cross-platform and not subject to shell quoting. The real wiring
 * uses the existing local sandbox backend.
 */
const testExecutor: CageExecutor = async (command, cwd) => {
  const del = command.match(/^delete\s+(.+)$/);
  if (del) { fs.rmSync(path.join(cwd, del[1].trim()), { force: true }); return { success: true, stdout: 'deleted', stderr: '' }; }
  const wr = command.match(/^write\s+(\S+)\s+(.+)$/);
  if (wr) { fs.writeFileSync(path.join(cwd, wr[1]), wr[2]); return { success: true, stdout: 'written', stderr: '' }; }
  return { success: true, stdout: 'noop', stderr: '' };
};

let cage: DirCageSandbox;
afterEach(() => { try { cage.dispose(); } catch {} });

function aff(over: Partial<Affordance>): Affordance {
  return { affordance_id: 'a', kind: 'cli_command', label: 'x', reversibility: 'reversible', ...over } as Affordance;
}

describe('S-04 — RevertibleSandbox (the cage)', () => {
  it('GATE: a destructive delete inside the cage is fully restored by revert; real data untouched', async () => {
    cage = new DirCageSandbox({ executor: testExecutor });
    cage.seed('filler.txt', 'filler-content');
    cage.seed('real.txt', 'REAL-DATA-DO-NOT-TOUCH');
    const realPath = path.join(cage.workDir, 'real.txt');
    const realBefore = fs.readFileSync(realPath, 'utf-8');

    const snap = await cage.snapshot();
    const res = await cage.runAction(aff({ reversibility: 'destructive', label: 'delete file', signature: 'delete filler.txt' }));
    expect(res.executed).toBe(true);
    expect(fs.existsSync(path.join(cage.workDir, 'filler.txt'))).toBe(false);   // really deleted
    expect(fs.readFileSync(realPath, 'utf-8')).toBe(realBefore);                 // real data untouched
    expect(res.before.ref).not.toBe(res.after.ref);                             // observable change

    await cage.revert(snap);
    expect(fs.existsSync(path.join(cage.workDir, 'filler.txt'))).toBe(true);     // FULLY restored
    expect(fs.readFileSync(path.join(cage.workDir, 'filler.txt'), 'utf-8')).toBe('filler-content');
    expect(fs.readFileSync(realPath, 'utf-8')).toBe(realBefore);
  });

  it('external_effect (send/pay) is DOCUMENTED, never fired — state unchanged', async () => {
    cage = new DirCageSandbox({ executor: testExecutor });
    cage.seed('data.txt', 'x');
    const before = cage.state().ref;
    const res = await cage.runAction(aff({ reversibility: 'external_effect', label: 'send email', signature: 'send email' }));
    expect(res.executed).toBe(false);
    expect(res.output).toMatch(/not fired/i);
    expect(cage.state().ref).toBe(before);   // nothing happened
  });

  it('runTrial always leaves the cage reverted (invariant)', async () => {
    cage = new DirCageSandbox({ executor: testExecutor });
    cage.seed('a.txt', 'one');
    const stateBefore = cage.state().ref;
    const trial = await runTrial(cage, aff({ reversibility: 'destructive', label: 'delete', signature: 'delete a.txt' }));
    expect(trial.on_revertible_sandbox).toBe(true);
    expect(trial.state_before.ref).not.toBe(trial.state_after.ref); // the action did change state
    expect(cage.state().ref).toBe(stateBefore);                     // ...but the cage is reverted after
  });
});
