/**
 * M-09 (static characterization, no launch) + M-13 (consolidate batches → versioned
 * persisted Atlas).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { characterizeStatic } from '../characterize/characterize.js';
import { consolidateAtlas, consolidateAndPersist } from '../atlas/consolidate.js';
import { ChizuStore } from '../store.js';
import type { SourceBatch } from '../discovery/fuse.js';

const stores: ChizuStore[] = [];
const mem = () => { const s = new ChizuStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe('chizu — M-09 caracterización estática (sin lanzar)', () => {
  it('CLI conocido por known_db; UIA queda unprobed (no se mide aquí)', () => {
    const c = characterizeStatic({ name: 'git', exe: 'git.exe', install_type: 'scoop' });
    expect(c.cli).toEqual({ available: true, evidence: 'known_db' });
    expect(c.uia.class).toBe('unprobed');
    expect(c.sandbox.verdict).toBe('easy');           // portable/scoop → easy
  });
  it('COM/scripting conocidos; instalado por registro → sandbox hard', () => {
    const c = characterizeStatic({ name: 'Adobe Photoshop', exe: 'photoshop.exe', install_type: 'registry' });
    expect(c.com_automation).toBe(true);
    expect(c.scripting_sdk).toBe(true);
    expect(c.sandbox.verdict).toBe('hard');
  });
  it('desconocido → todo unknown (honesto, nada inventado)', () => {
    const c = characterizeStatic({ name: 'WeirdApp', install_type: 'unknown' });
    expect(c.cli.available).toBe('unknown');
    expect(c.com_automation).toBe('unknown');
    expect(c.sandbox.verdict).toBe('unknown');
  });
});

describe('chizu — M-13 consolidación + persistencia versionada', () => {
  const batches: SourceBatch[] = [
    { source: 'registry_uninstall', apps: [{ raw_name: 'Figma', raw_path: 'C:/figma/figma.exe', meta: { version: '1.0' } }] },
    { source: 'winget', apps: [{ raw_name: 'Figma', raw_path: 'C:/figma/figma.exe', meta: { version: '1.1' } }] },   // same app, two sources
  ];

  it('consolidateAtlas dedup por identidad canónica + registra discrepancias', () => {
    const { cards } = consolidateAtlas(batches, 't');
    expect(cards).toHaveLength(1);                     // deduped
    expect(cards[0].discovered_by).toHaveLength(2);    // both sources kept
    expect(cards[0].discrepancies?.[0]).toMatch(/version/);
  });

  it('consolidateAndPersist guarda un scan y devuelve el Atlas vivo', () => {
    const s = mem();
    const atlas = consolidateAndPersist(batches, s, 'scan-1', 't');
    expect(atlas.query()).toHaveLength(1);
    expect(s.latestScanId()).toBe('scan-1');
    expect(s.loadAtlas().map((c) => c.display_name)).toEqual(['Figma']);
  });
});
