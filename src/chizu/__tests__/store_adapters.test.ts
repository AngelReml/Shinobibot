/**
 * M-02/M-03 — versioned store (scan snapshots, idempotent) + adapters (discovery
 * runner parses real-command output; protected-resource publish to the approval gate).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ChizuStore } from '../store.js';
import { discoverSource, protectedResources, DISCOVERY_COMMANDS } from '../adapters.js';
import type { AppCard } from '../types.js';

function mkCard(over: Partial<AppCard>): AppCard {
  return {
    app_id: 'id', display_name: 'X', install_type: 'registry', discovered_by: [],
    usage: { usage_score: 0.5, signal_sources: [] },
    characterization: { cli: { available: 'unknown', evidence: 'none' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: 'unknown', needs_install: 'unknown', needs_network: 'unknown', needs_login: 'unknown', verdict: 'unknown' } },
    category: 'other', risk: { level: 'safe', reasons: [], becomes_protected_resource: false },
    automation_candidate_score: 0, provenance: { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: 't', trust_tier: 2, session_seq: 0 }, mapped_at: 't',
    ...over,
  } as AppCard;
}

const stores: ChizuStore[] = [];
const mem = () => { const s = new ChizuStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe('chizu/store — M-02 versionado por scan', () => {
  it('idempotente + atlas versionado: latest scan es el vivo', () => {
    const s = mem();
    expect(() => new ChizuStore({ db_path: s.dbPath })).not.toThrow();
    s.saveScan('scan-1', [mkCard({ app_id: 'a', display_name: 'A' })], '2026-01-01');
    s.saveScan('scan-2', [mkCard({ app_id: 'a', display_name: 'A' }), mkCard({ app_id: 'b', display_name: 'B' })], '2026-01-02');
    expect(s.latestScanId()).toBe('scan-2');
    expect(s.loadAtlas().map((c) => c.app_id).sort()).toEqual(['a', 'b']);     // latest
    expect(s.loadAtlas('scan-1').map((c) => c.app_id)).toEqual(['a']);          // history kept
    expect(s.listScans()).toHaveLength(2);
  });
});

describe('chizu/adapters — M-03 ENGANCHE', () => {
  it('discoverSource parses a real-command stdout into a SourceBatch (runner injected)', async () => {
    const fakeJson = JSON.stringify([{ DisplayName: 'Figma', DisplayVersion: '1.0', Publisher: 'Figma', InstallLocation: 'C:/figma' }]);
    const run = async () => ({ success: true, stdout: fakeJson, stderr: '' });
    const batch = await discoverSource('registry_uninstall', run);
    expect(batch.source).toBe('registry_uninstall');
    expect(batch.apps[0].raw_name).toBe('Figma');
  });

  it('a failing/missing command → empty batch (honest, never invents)', async () => {
    const run = async () => ({ success: false, stdout: '', stderr: 'not found' });
    expect((await discoverSource('winget', run)).apps).toEqual([]);
  });

  it('every known source has a real command spec', () => {
    expect(DISCOVERY_COMMANDS.registry_uninstall?.command).toMatch(/Uninstall/);
    expect(DISCOVERY_COMMANDS.appx?.command).toMatch(/AppxPackage/);
  });

  it('protectedResources publishes exactly the dangerous/forbidden apps', () => {
    const cards = [
      mkCard({ app_id: 'safe', risk: { level: 'safe', reasons: [], becomes_protected_resource: false } }),
      mkCard({ app_id: 'bank', display_name: 'Bank', risk: { level: 'dangerous', reasons: ['financial'], becomes_protected_resource: true } }),
    ];
    const prot = protectedResources(cards);
    expect(prot.map((p) => p.app_id)).toEqual(['bank']);
    expect(prot[0].reasons).toContain('financial');
  });
});
