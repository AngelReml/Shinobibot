/**
 * M-15 — LA PRUEBA DURA del Nivel 3 (dossier §12, P1–P7). El cartógrafo, end-to-end,
 * salida binaria. P3 (uso fiel) y P7 (cero alucinaciones) son los que separan un mapa
 * fiel de uno plausible: mide el uso real y no inventa una sola calle.
 */
import { describe, it, expect } from 'vitest';
import { fuse, type SourceBatch } from '../discovery/fuse.js';
import { scoreUsage, rankByUsage } from '../usage/score.js';
import { classifyRisk } from '../characterize/risk.js';
import { characterizeStatic } from '../characterize/characterize.js';
import { classifyUia } from '../characterize/probe.js';
import { protectedResources } from '../adapters.js';
import { Atlas } from '../atlas/atlas.js';
import type { AppCard } from '../types.js';

// Montaje: un portable escondido, un duplicado en 3 fuentes, un peligroso, etc.
const batches: SourceBatch[] = [
  { source: 'path_scan', apps: [{ raw_name: 'PortaTool', raw_path: 'D:/tools/portatool.exe', meta: {} }] },          // portable escondido
  { source: 'registry_uninstall', apps: [{ raw_name: 'Figma', raw_path: 'C:/figma/figma.exe', meta: { version: '1.0' } }] },
  { source: 'winget', apps: [{ raw_name: 'Figma', raw_path: 'C:/figma/figma.exe', meta: {} }] },                      // dup
  { source: 'appx', apps: [{ raw_name: 'Figma', raw_path: 'C:/figma/figma.exe', meta: {} }] },                        // dup (3ª fuente)
  { source: 'registry_uninstall', apps: [{ raw_name: 'MyBank', raw_path: 'C:/bank/bank.exe', meta: { publisher: 'Bank Inc' } }] },  // peligroso
];

describe('chizu — M-15 LA PRUEBA DURA (P1–P7)', () => {
  const cards = fuse(batches, { retrievedAt: 't' });
  const byName = (n: string) => cards.find((c) => c.display_name === n)!;

  it('P1 — portable descubierto con install_type portable y fuente correcta', () => {
    const p = byName('PortaTool');
    expect(p.install_type).toBe('portable');
    expect(p.discovered_by.map((d) => d.source)).toContain('path_scan');
  });

  it('P2 — dedup correcto: Figma una vez, discovered_by = las tres fuentes', () => {
    const figmas = cards.filter((c) => c.display_name === 'Figma');
    expect(figmas).toHaveLength(1);
    expect(figmas[0].discovered_by.map((d) => d.source).sort()).toEqual(['appx', 'registry_uninstall', 'winget']);
  });

  it('P3 — uso fiel: usado-mucho arriba, instalado-nunca-usado al fondo (medido, no asumido)', () => {
    const used = scoreUsage({ run_count: 200, recency_days: 1 });
    const never = scoreUsage({ run_count: 0 });
    const ranked = rankByUsage([
      { ...byName('Figma'), usage: { usage_score: used, signal_sources: ['userassist'] } },
      { ...byName('MyBank'), usage: { usage_score: never, signal_sources: [] } },
    ] as AppCard[]);
    expect(ranked[0].display_name).toBe('Figma');
    expect(ranked[ranked.length - 1].display_name).toBe('MyBank');
  });

  it('P4 — riesgo correcto + protección armada: peligroso → dangerous/forbidden + recurso protegido', () => {
    const risk = classifyRisk({ name: 'MyBank', publisher: 'Bank Inc', category: 'finance' });
    expect(['dangerous', 'forbidden']).toContain(risk.level);
    expect(risk.becomes_protected_resource).toBe(true);
    const card: AppCard = { ...byName('MyBank'), risk };
    expect(protectedResources([card]).map((p) => p.display_name)).toEqual(['MyBank']);
  });

  it('P5 — opaco vs rich: canvas opaco, Win32 estándar rich', () => {
    expect(classifyUia({ control_count: 1, named_ratio: 0 })).toBe('opaque');     // canvas
    expect(classifyUia({ control_count: 30, named_ratio: 0.9 })).toBe('rich');     // Win32
  });

  it('P6 — CLI detectado con evidencia', () => {
    const c = characterizeStatic({ name: 'git', exe: 'git.exe', install_type: 'scoop' });
    expect(c.cli.available).toBe(true);
    expect(c.cli.evidence).toBe('known_db');
  });

  it('P7 — CERO alucinaciones: cada entrada del Atlas rastreable a una fuente real', () => {
    const atlas = new Atlas(cards);
    for (const c of atlas.query()) {
      expect(c.discovered_by.length).toBeGreaterThan(0);          // toda entrada tiene fuente
      expect(c.provenance.origin).toBe('TOOL_INTERNAL');
    }
    // y no hay más apps que las que las fuentes reportaron (3 identidades canónicas).
    expect(atlas.query()).toHaveLength(3);
  });
});
