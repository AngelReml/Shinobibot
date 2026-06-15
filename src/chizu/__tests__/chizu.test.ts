import { describe, it, expect } from 'vitest';
import { chizuEnabled } from '../config.js';
import { fuse, type SourceBatch } from '../discovery/fuse.js';
import { scoreUsage, rankByUsage } from '../usage/score.js';
import { classifyRisk, inferCategory } from '../characterize/risk.js';
import { automationCandidateScore } from '../characterize/candidate.js';
import { Atlas } from '../atlas/atlas.js';
import type { AppCard } from '../types.js';

describe('chizu — flag', () => {
  it('CHIZU_ENABLED default off', () => { expect(chizuEnabled()).toBe(false); });
});

describe('chizu — discovery fusion + dedup (§6.3)', () => {
  it('one app seen by 3 sources → ONE card with 3 discovered_by; cero inventos', () => {
    const exe = 'C:/Program Files/Acme/acme.exe';
    const batches: SourceBatch[] = [
      { source: 'registry_uninstall', apps: [{ raw_name: 'Acme', raw_path: exe, meta: { version: '1.0', publisher: 'Acme Inc' } }] },
      { source: 'winget', apps: [{ raw_name: 'Acme', raw_path: exe, meta: { version: '1.0' } }] },
      { source: 'start_menu', apps: [{ raw_name: 'Acme', raw_path: exe, meta: {} }] },
    ];
    const cards = fuse(batches, { retrievedAt: 't' });
    expect(cards.length).toBe(1);
    expect(cards[0].discovered_by.length).toBe(3);
    expect(cards[0].install_type).toBe('registry');
  });
  it('a portable seen only by programfiles_scan appears (install_type portable)', () => {
    const cards = fuse([{ source: 'programfiles_scan', apps: [{ raw_name: 'PortableTool', raw_path: 'D:/tools/pt.exe', meta: {} }] }], { retrievedAt: 't' });
    expect(cards.length).toBe(1); expect(cards[0].install_type).toBe('portable');
  });
  it('version discrepancy is recorded, not hidden', () => {
    const exe = 'C:/x/app.exe';
    const cards = fuse([
      { source: 'registry_uninstall', apps: [{ raw_name: 'App', raw_path: exe, meta: { version: '1.0' } }] },
      { source: 'winget', apps: [{ raw_name: 'App', raw_path: exe, meta: { version: '2.0' } }] },
    ], { retrievedAt: 't' });
    expect(cards[0].discrepancies?.some((d) => d.includes('1.0') && d.includes('2.0'))).toBe(true);
  });
});

describe('chizu — usage scoring (§7.2)', () => {
  it('heavily used + recent ranks above installed-never-used', () => {
    const used = scoreUsage({ run_count: 200, recency_days: 1, signal_sources: ['userassist', 'prefetch'] });
    const never = scoreUsage({ run_count: 0 });
    expect(used).toBeGreaterThan(never);
    expect(used).toBeGreaterThan(0.5);
    expect(never).toBeLessThan(0.2);
  });
});

describe('chizu — risk rules (§8.4) arm the approval gate', () => {
  it('bank → dangerous + protected; regedit → forbidden + protected; viewer → safe; office → caution', () => {
    const bank = classifyRisk({ name: 'BBVA Banca' });
    expect(bank.level).toBe('dangerous'); expect(bank.becomes_protected_resource).toBe(true);
    const sys = classifyRisk({ name: 'Registry Editor (regedit)' });
    expect(sys.level).toBe('forbidden'); expect(sys.becomes_protected_resource).toBe(true);
    expect(classifyRisk({ name: 'Image Viewer', category: 'media' }).level).toBe('safe');
    expect(classifyRisk({ name: 'Microsoft Word' }).level).toBe('caution');
  });
  it('inferCategory recognizes obvious apps', () => {
    expect(inferCategory('Google Chrome')).toBe('browser');
    expect(inferCategory('Visual Studio Code')).toBe('dev');
  });
});

function mkCard(over: Partial<AppCard>): AppCard {
  return {
    app_id: over.app_id ?? 'id', display_name: over.display_name ?? 'X', install_type: 'registry', discovered_by: [],
    usage: over.usage ?? { usage_score: 0.5, signal_sources: [] },
    characterization: over.characterization ?? { cli: { available: 'unknown', evidence: 'none' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: 'unknown', needs_install: 'unknown', needs_network: 'unknown', needs_login: 'unknown', verdict: 'unknown' } },
    category: over.category ?? 'other', risk: over.risk ?? { level: 'safe', reasons: [], becomes_protected_resource: false },
    automation_candidate_score: 0, provenance: { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: 't', trust_tier: 2, session_seq: 0 }, mapped_at: 't',
    ...over,
  } as AppCard;
}

describe('chizu — automation candidate score (§8.5)', () => {
  it('high usage + CLI + safe scores high; opaque + dangerous scores ~0', () => {
    const good = mkCard({ usage: { usage_score: 0.9, signal_sources: [] }, characterization: { cli: { available: true, evidence: 'help_probe' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: true, needs_install: false, needs_network: false, needs_login: false, verdict: 'easy' } }, risk: { level: 'safe', reasons: [], becomes_protected_resource: false } });
    const bad = mkCard({ usage: { usage_score: 0.2, signal_sources: [] }, characterization: { cli: { available: false, evidence: 'none' }, com_automation: false, scripting_sdk: false, uia: { class: 'opaque' }, sandbox: { portable: false, needs_install: true, needs_network: true, needs_login: true, verdict: 'unsafe' } }, risk: { level: 'dangerous', reasons: ['financial'], becomes_protected_resource: true } });
    expect(automationCandidateScore(good)).toBeGreaterThan(0.7);
    expect(automationCandidateScore(bad)).toBeLessThan(0.2);
  });
});

describe('chizu — Atlas query + candidates + render (§9)', () => {
  const cards: AppCard[] = [
    mkCard({ app_id: 'a', display_name: 'GoodCLI', category: 'dev', usage: { usage_score: 0.9, signal_sources: [] }, characterization: { cli: { available: true, evidence: 'help_probe' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: true, needs_install: false, needs_network: false, needs_login: false, verdict: 'easy' } }, risk: { level: 'safe', reasons: [], becomes_protected_resource: false }, automation_candidate_score: 0.85 }),
    mkCard({ app_id: 'b', display_name: 'MyBank', category: 'finance', risk: { level: 'dangerous', reasons: ['financial'], becomes_protected_resource: true }, automation_candidate_score: 0.1 }),
  ];
  const atlas = new Atlas(cards);
  it('candidatesForExplorer excludes dangerous + orders by score', () => {
    const cands = atlas.candidatesForExplorer();
    expect(cands.map((c) => c.app_id)).toEqual(['a']);   // bank excluded
  });
  it('query by maxRisk filters protected apps', () => {
    expect(atlas.query({ maxRisk: 'caution' }).map((c) => c.app_id)).toEqual(['a']);
  });
  it('renderMarkdown has the four views + the honesty line', () => {
    const md = atlas.renderMarkdown('scan1');
    expect(md).toContain('Por uso');
    expect(md).toContain('Por automatizabilidad');
    expect(md).toContain('Por riesgo');
    expect(md).toContain('Candidatos para el Explorador');
    expect(md).toContain('no haya pisado');
  });
});
