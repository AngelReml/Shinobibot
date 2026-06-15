/**
 * S-12 — UIA surface extraction + UI graph (the hard regime after CLI). Live UIA
 * read injected; the surface/graph build + reversibility classification are pure.
 */
import { describe, it, expect } from 'vitest';
import { extractAffordances, buildUiSurface, uiGraph, type UiaNode } from '../surface/uia_surface.js';

const tree: UiaNode = {
  control_type: 'Window', name: 'Editor',
  children: [
    { control_type: 'MenuItem', name: 'Open' },
    { control_type: 'MenuItem', name: 'Delete All' },        // destructive
    { control_type: 'Button', name: 'Send to Printer' },     // external_effect-ish
    { control_type: 'Text', name: 'just a label' },          // not actionable
    { control_type: 'Edit', name: 'Filename' },
  ],
};

describe('shugyo — S-12 superficie UIA + grafo', () => {
  it('extrae solo controles accionables y nombrados como Affordances', () => {
    const aff = extractAffordances(tree);
    expect(aff.map((a) => a.label).sort()).toEqual(['Delete All', 'Filename', 'Open', 'Send to Printer']);
    expect(aff.every((a) => a.kind === 'ui_control')).toBe(true);
  });

  it('clasifica reversibilidad de cada control (anti-destrucción)', () => {
    const aff = extractAffordances(tree);
    const open = aff.find((a) => a.label === 'Open')!;
    const del = aff.find((a) => a.label === 'Delete All')!;
    expect(open.reversibility).toBe('reversible');
    expect(del.reversibility).toBe('destructive');
  });

  it('buildUiSurface marca via=uia', () => {
    expect(buildUiSurface('app1', tree).via).toBe('uia');
  });

  it('uiGraph construye nodos + aristas padre→hijo', () => {
    const g = uiGraph(tree);
    expect(g.nodes).toContain('Editor');
    expect(g.edges.filter((e) => e.from === 'Editor')).toHaveLength(5);   // 5 hijos
  });
});
