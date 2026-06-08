// src/agents/__tests__/objective_verifier.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runObjectiveChecks, objectiveVerdict } from '../objective_verifier.js';
import { runVerifiedAgent } from '../verified_agent.js';
import type { LLMInvoker } from '../agent_loop.js';

const node = process.execPath;
const envelope = (c: string) => JSON.stringify({ content: c });
const verdictPass: LLMInvoker = async () =>
  ({ success: true, output: envelope(JSON.stringify({ passed: true, score: 0.95, issues: [], rationale: 'ok' })), error: '' });

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

describe('runObjectiveChecks', () => {
  it('exit 0 = pasa, exit 1 = falla (subprocesos reales)', () => {
    const res = runObjectiveChecks([
      { label: 'ok', command: node, args: ['-e', 'process.exit(0)'] },
      { label: 'ko', command: node, args: ['-e', 'console.error("boom"); process.exit(1)'] },
    ]);
    expect(res.find((r) => r.label === 'ok')!.passed).toBe(true);
    const ko = res.find((r) => r.label === 'ko')!;
    expect(ko.passed).toBe(false);
    expect(ko.exitCode).toBe(1);
  });

  it('comando inexistente → falla limpio (no lanza)', () => {
    const res = runObjectiveChecks([{ label: 'nope', command: 'comando-que-no-existe-xyz', args: [] }]);
    expect(res[0].passed).toBe(false);
  });

  it('objectiveVerdict resume passed/issues', () => {
    expect(objectiveVerdict([{ label: 'a', passed: true, exitCode: 0, output: '' }]).passed).toBe(true);
    const v = objectiveVerdict([{ label: 'tests', passed: false, exitCode: 1, output: 'FAIL x' }]);
    expect(v.passed).toBe(false);
    expect(v.issues[0]).toMatch(/tests.*falló/);
  });
});

describe('runVerifiedAgent + objectiveCheck (pre-gate duro)', () => {
  const producer: LLMInvoker = async () => ({ success: true, output: envelope('listo'), error: '' });

  it('si el control objetivo FALLA, NO se aprueba aunque el LLM apruebe', async () => {
    const r = await runVerifiedAgent({
      task: 'haz X', systemPrompt: 's', tools: [], maxAttempts: 1,
      invokeLLM: producer, verifyInvokeLLM: verdictPass,
      objectiveCheck: async () => ({ passed: false, issues: ['tests rojos'] }),
    });
    expect(r.ok).toBe(false);
    expect(r.verdict.issues).toContain('tests rojos');
  });

  it('si el control objetivo PASA y el LLM aprueba, ok', async () => {
    const r = await runVerifiedAgent({
      task: 'haz X', systemPrompt: 's', tools: [], maxAttempts: 1,
      invokeLLM: producer, verifyInvokeLLM: verdictPass,
      objectiveCheck: async () => ({ passed: true, issues: [] }),
    });
    expect(r.ok).toBe(true);
  });
});
