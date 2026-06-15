/**
 * tenshu/system_map.ts — TS-09: the live system map. The dojo's topology (who feeds
 * whom) annotated with LIVENESS derived from the recorded events — node state and
 * last activity come from real events, not assumed. Pure: a render is a trivial
 * wrapper over this structure.
 */

import type { SystemEvent, DojoSource, SubsystemState } from './types.js';

/** Canonical dojo topology (the map's fixed edges; liveness is overlaid from events). */
export const DOJO_TOPOLOGY: { from: DojoSource; to: DojoSource; flow: string }[] = [
  { from: 'chizu', to: 'shugyo', flow: 'targets' },
  { from: 'shugyo', to: 'kagami', flow: 'certified skills → frontier' },
  { from: 'kagemusha', to: 'kagami', flow: 'dawn report' },
  { from: 'shugyo', to: 'shitsuji', flow: 'repertoire' },
  { from: 'chizu', to: 'shitsuji', flow: 'app lookup' },
  { from: 'kangeiko', to: 'shugyo', flow: 'fabricate' },
  { from: 'kangeiko', to: 'kagami', flow: 'measure' },
];

export interface MapNode { source: DojoSource; state: SubsystemState; last_kind?: string; last_ts?: string; event_count: number; }
export interface SystemMap { nodes: MapNode[]; edges: typeof DOJO_TOPOLOGY; active_sources: DojoSource[]; }

/** Liveness of one source from its events (latest wins; error → halted). */
function livenessOf(source: DojoSource, events: SystemEvent[]): MapNode {
  const mine = events.filter((e) => e.source === source);
  let state: SubsystemState = 'idle';
  let last: SystemEvent | undefined;
  for (const e of mine) {
    last = e;
    if (e.kind === 'error') state = 'halted';
    else if (e.kind === 'phase_start' || e.kind === 'action') state = 'running';
    else if (e.kind === 'phase_end') state = 'idle';
  }
  return { source, state, last_kind: last?.kind, last_ts: last?.ts, event_count: mine.length };
}

export function buildSystemMap(sources: DojoSource[], events: SystemEvent[]): SystemMap {
  const nodes = sources.map((s) => livenessOf(s, events));
  return {
    nodes,
    edges: DOJO_TOPOLOGY.filter((e) => sources.includes(e.from) && sources.includes(e.to)),
    active_sources: nodes.filter((n) => n.state === 'running').map((n) => n.source),
  };
}

/** Plain render of the live map (the SPA is a trivial visual wrapper over this). */
export function renderSystemMap(map: SystemMap): string {
  const L = ['Mapa vivo del dojo:'];
  for (const n of map.nodes) L.push(`  ${n.source}: ${n.state}${n.last_kind ? ` (último: ${n.last_kind})` : ''} · ${n.event_count} eventos`);
  L.push('Flujos:');
  for (const e of map.edges) L.push(`  ${e.from} → ${e.to} [${e.flow}]`);
  return L.join('\n');
}
