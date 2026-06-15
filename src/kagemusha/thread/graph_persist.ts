/**
 * kagemusha/thread/graph_persist.ts — C-13: persist & RESUME the research graph. The
 * store already holds nodes/edges/claims/content/mission_state (store.ts); this adds
 * the resume LOGIC: rebuild the in-memory graph + the visited set + the frontier from
 * a persisted mission, so a night interrupted continues where it left off without
 * re-walking what it already visited (anti-cycle preserved).
 */

import { Frontier, canonical } from './frontier.js';
import type { KagemushaStore } from '../store/store.js';
import type { ResearchNode, ResearchEdge, Claim, MissionState } from '../types.js';

export interface PersistedGraph { nodes: ResearchNode[]; edges: ResearchEdge[]; claims: Claim[]; }

/** Persist a graph slice (idempotent upserts). */
export function persistGraph(store: KagemushaStore, g: PersistedGraph): void {
  for (const n of g.nodes) store.upsertNode(n);
  for (const e of g.edges) store.addEdge(e);
  for (const c of g.claims) store.upsertClaim(c);
}

export function loadGraph(store: KagemushaStore): PersistedGraph {
  return { nodes: store.listNodes(), edges: store.listEdges(), claims: store.listClaims() };
}

export interface ResumedMission {
  state: MissionState;
  graph: PersistedGraph;
  visited: Set<string>;
  frontier: Frontier;
}

/**
 * Resume a mission: load its persisted state + graph, rebuild the visited set (so we
 * never re-investigate a canonical key) and the frontier (the pending candidates).
 * Returns null if the mission was never persisted.
 */
export function resumeMissionGraph(store: KagemushaStore, missionId: string): ResumedMission | null {
  const state = store.loadMissionState(missionId);
  if (!state) return null;
  const graph = loadGraph(store);
  const visited = new Set<string>(state.visited ?? []);
  const frontier = new Frontier((state.frontier ?? []).filter((item) => !visited.has(canonical(item.candidate))));
  return { state, graph, visited, frontier };
}
