/**
 * TS-09 — live system map: topology + liveness derived from real events.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemMap, renderSystemMap } from '../system_map.js';
import type { SystemEvent } from '../types.js';

const events: SystemEvent[] = [
  { event_id: 'e1', source: 'kagemusha', kind: 'phase_start', payload: {}, ts: 't1' },
  { event_id: 'e2', source: 'shugyo', kind: 'error', payload: {}, ts: 't2' },
  { event_id: 'e3', source: 'kagemusha', kind: 'phase_end', payload: {}, ts: 't3' },
];

describe('tenshu — TS-09 mapa vivo', () => {
  it('liveness derivada de eventos reales (no asumida)', () => {
    const map = buildSystemMap(['kagemusha', 'shugyo', 'chizu'], events);
    const kagemusha = map.nodes.find((n) => n.source === 'kagemusha')!;
    const shugyo = map.nodes.find((n) => n.source === 'shugyo')!;
    const chizu = map.nodes.find((n) => n.source === 'chizu')!;
    expect(kagemusha.state).toBe('idle');     // phase_start luego phase_end
    expect(shugyo.state).toBe('halted');      // error
    expect(chizu.state).toBe('idle');         // sin eventos
    expect(chizu.event_count).toBe(0);
  });

  it('aristas solo entre fuentes presentes; render legible', () => {
    const map = buildSystemMap(['chizu', 'shugyo'], events);
    expect(map.edges.some((e) => e.from === 'chizu' && e.to === 'shugyo')).toBe(true);
    expect(map.edges.every((e) => ['chizu', 'shugyo'].includes(e.from) && ['chizu', 'shugyo'].includes(e.to))).toBe(true);
    expect(renderSystemMap(map)).toMatch(/Mapa vivo del dojo/);
  });
});
