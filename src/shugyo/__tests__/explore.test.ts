import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DirCageSandbox, type CageExecutor } from '../sandbox/revertible.js';
import { explore, orderByValue } from '../explore/explorer.js';
import { induceModel } from '../model/induce.js';
import { selectTarget, chooseVia } from '../target.js';
import type { Affordance } from '../types.js';
import type { AppCard } from '../../chizu/types.js';

const exec: CageExecutor = async (command, cwd) => {
  const wr = command.match(/^write\s+(\S+)\s+(.+)$/);
  if (wr) { fs.writeFileSync(path.join(cwd, wr[1]), wr[2]); return { success: true, stdout: 'ok', stderr: '' }; }
  const del = command.match(/^delete\s+(.+)$/);
  if (del) { fs.rmSync(path.join(cwd, del[1].trim()), { force: true }); return { success: true, stdout: 'ok', stderr: '' }; }
  return { success: true, stdout: 'noop', stderr: '' };
};

let cage: DirCageSandbox;
afterEach(() => { try { cage.dispose(); } catch {} });

function mkCard(over: Partial<AppCard>): AppCard {
  return {
    app_id: over.app_id ?? 'id', display_name: over.display_name ?? 'X', install_type: 'registry', discovered_by: [],
    usage: { usage_score: 0.5, signal_sources: [] },
    characterization: over.characterization ?? { cli: { available: true, evidence: 'help_probe' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: true, needs_install: false, needs_network: false, needs_login: false, verdict: 'easy' } },
    category: 'dev', risk: over.risk ?? { level: 'safe', reasons: [], becomes_protected_resource: false },
    automation_candidate_score: over.automation_candidate_score ?? 0.8, provenance: { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: 't', trust_tier: 2, session_seq: 0 }, mapped_at: 't', ...over,
  } as AppCard;
}

describe('S-05 — target selection from Chizu (prudence filters)', () => {
  it('picks safe + CLI, skips dangerous and canvas', () => {
    const cands = [
      mkCard({ app_id: 'bank', display_name: 'Bank', risk: { level: 'dangerous', reasons: ['financial'], becomes_protected_resource: true }, automation_candidate_score: 0.9 }),
      mkCard({ app_id: 'opaque', display_name: 'Game', characterization: { cli: { available: false, evidence: 'none' }, com_automation: false, scripting_sdk: false, uia: { class: 'opaque' }, sandbox: { portable: true, needs_install: false, needs_network: false, needs_login: false, verdict: 'easy' } }, automation_candidate_score: 0.8 }),
      mkCard({ app_id: 'tool', display_name: 'Converter', automation_candidate_score: 0.7 }),
    ];
    const t = selectTarget(cands);
    expect(t?.app.app_id).toBe('tool');   // bank excluded, game (canvas) excluded
    expect(t?.via).toBe('cli');
    expect(chooseVia(cands[0])).toBe('cli');
  });
});

const surface: Affordance[] = [
  { affordance_id: 'create', kind: 'cli_command', label: 'create file', signature: 'write out.txt hello', reversibility: 'reversible' },
  { affordance_id: 'del', kind: 'cli_command', label: 'delete file', signature: 'delete filler.txt', reversibility: 'destructive' },
  { affordance_id: 'send', kind: 'cli_command', label: 'send email', signature: 'send email', reversibility: 'external_effect' },
];

describe('S-08 — explorer probes the cage under budget, never fires external', () => {
  it('orders reversible first, external last', () => {
    expect(orderByValue(surface).map((a) => a.affordance_id)).toEqual(['create', 'del', 'send']);
  });
  it('produces trials; external documented not fired; cage reverted', async () => {
    cage = new DirCageSandbox({ executor: exec });
    cage.seed('filler.txt', 'filler');
    const stateBefore = cage.state().ref;
    const { trials, externalDocumented } = await explore(surface, cage, { maxActions: 10 });
    expect(trials.length).toBe(3);
    expect(externalDocumented).toBe(1);
    const sendTrial = trials.find((t) => t.affordance_id === 'send')!;
    expect(sendTrial.observed_effect).toMatch(/not fired/i);
    expect(cage.state().ref).toBe(stateBefore);   // cage fully reverted after exploration
  });
});

describe('S-09 — model induction (only effectful executed trials → capabilities)', () => {
  it('builds capabilities from reversible+destructive, not from external; grade strong for cli', async () => {
    cage = new DirCageSandbox({ executor: exec });
    cage.seed('filler.txt', 'filler');
    const { trials } = await explore(surface, cage, { maxActions: 10 });
    const model = induceModel(trials, surface, 'converter', 'cli');
    const ids = model.capabilities.map((c) => c.capability_id);
    expect(ids.some((i) => i.includes('create'))).toBe(true);
    expect(ids.some((i) => i.includes('delete'))).toBe(true);
    expect(ids.some((i) => i.includes('send'))).toBe(false);   // external never a capability
    expect(model.capabilities.every((c) => c.grade === 'strong')).toBe(true);
    expect(model.confidence).toBeGreaterThan(0.5);
  });
});
