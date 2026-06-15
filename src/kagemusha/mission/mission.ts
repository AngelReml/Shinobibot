/**
 * kagemusha/mission/mission.ts — the night mission as a state machine (dossier §12).
 * NOT a new loop: it sequences the existing subsystems and the new phases. Budgets
 * (tokens/threads/time) are enforced; the state is persisted per phase so it
 * RESUMES if the night cycle is cut; and ABORT NEVER produces silence — if budget
 * runs out, the report is emitted anyway, marking what went uninvestigated.
 *
 * The phase BODIES are injected (they call the LLM/swarm/CDP live parts), so the
 * orchestration is deterministic and testable with stub handlers.
 */

import type { DawnReport, MissionSpec, MissionState, MissionPhase } from '../types.js';
import type { KagemushaStore } from '../store/store.js';

export interface PhaseCost { tokens?: number }

export interface PhaseHandlers {
  ingest(spec: MissionSpec, state: MissionState): Promise<PhaseCost & { transcripts: number; channels: number }>;
  analyze(state: MissionState): Promise<PhaseCost & { seeds: number }>;
  /** One thread pull. Returns whether more remain and the cost. Called repeatedly
   *  under budget — this is where ABORT-with-gaps happens. */
  thread(state: MissionState): Promise<PhaseCost & { moreSeeds: boolean; investigated: number }>;
  contrast(state: MissionState): Promise<PhaseCost>;
  synthesize(state: MissionState, looked_at: DawnReport['looked_at'], gaps: string[]): Promise<DawnReport>;
}

const ORDER: MissionPhase[] = ['INIT', 'INGEST', 'ANALYZE', 'THREAD', 'CONTRAST', 'SYNTHESIZE', 'REPORT', 'DONE'];

export interface MissionResult { state: MissionState; report: DawnReport | null; perPhaseTokens: Record<string, number>; }

function nowIso(ts: string): string { return ts; }

/**
 * Drive a mission from a spec. `ts` is passed in (Date.* is avoided so runs are
 * reproducible). Persists state after each phase (resume). Returns the report.
 */
export async function runMission(spec: MissionSpec, store: KagemushaStore, handlers: PhaseHandlers, opts: { missionId: string; ts: string }): Promise<MissionResult> {
  const state: MissionState = {
    mission_id: opts.missionId, phase: 'INIT', spec, frontier: [], visited: [],
    threadsOpened: 0, tokensSpent: 0, startedAt: opts.ts, updatedAt: opts.ts, gaps: [],
  };
  return driveFrom(state, store, handlers, opts.ts);
}

/** Resume a persisted mission from where it left off. */
export async function resumeMission(missionId: string, store: KagemushaStore, handlers: PhaseHandlers, ts: string): Promise<MissionResult> {
  const state = store.loadMissionState(missionId);
  if (!state) throw new Error(`mission ${missionId} not found`);
  return driveFrom(state, store, handlers, ts);
}

async function driveFrom(state: MissionState, store: KagemushaStore, h: PhaseHandlers, ts: string): Promise<MissionResult> {
  const perPhaseTokens: Record<string, number> = {};
  const spend = (phase: string, c: PhaseCost) => { const t = c.tokens ?? 0; perPhaseTokens[phase] = (perPhaseTokens[phase] ?? 0) + t; state.tokensSpent += t; };
  const persist = (phase: MissionPhase) => { state.phase = phase; state.updatedAt = ts; store.saveMissionState(state); };
  const budgetExhausted = () => state.tokensSpent >= state.spec.budget.maxTokens;

  const looked_at = { channels: 0, transcripts: 0, threads: 0 };
  let report: DawnReport | null = null;

  // Resume: skip phases already past. ORDER index of current phase.
  const startIdx = Math.max(0, ORDER.indexOf(state.phase === 'PAUSED' || state.phase === 'ABORT' ? 'THREAD' : state.phase));

  try {
    if (startIdx <= ORDER.indexOf('INGEST')) { persist('INGEST'); const r = await h.ingest(state.spec, state); spend('INGEST', r); looked_at.channels = r.channels; looked_at.transcripts = r.transcripts; }
    if (startIdx <= ORDER.indexOf('ANALYZE')) { persist('ANALYZE'); const r = await h.analyze(state); spend('ANALYZE', r); }

    // THREAD: reentrant sub-loop under budget. ABORT-with-gaps lives here.
    persist('THREAD');
    let more = true;
    while (more) {
      if (budgetExhausted()) { state.gaps.push(`presupuesto de tokens agotado tras ${state.threadsOpened} hilos; quedaron semillas sin investigar`); break; }
      if (state.threadsOpened >= state.spec.budget.maxThreads) { state.gaps.push(`límite de ${state.spec.budget.maxThreads} hilos alcanzado; quedaron semillas sin investigar`); break; }
      const r = await h.thread(state);
      spend('THREAD', r);
      state.threadsOpened += r.investigated;
      looked_at.threads += r.investigated;
      more = r.moreSeeds;
      store.saveMissionState(state);
    }

    if (!budgetExhausted()) { persist('CONTRAST'); spend('CONTRAST', await h.contrast(state)); }
    else state.gaps.push('contraste con el código omitido por presupuesto');

    persist('SYNTHESIZE');
    report = await h.synthesize(state, looked_at, state.gaps);
    if (report) store.saveReport(report);

    persist('REPORT');
    persist('DONE');
  } catch (e: any) {
    // Fatal error → ABORT honestly with a partial report (no silence).
    state.gaps.push(`abortado por error: ${e.message}`);
    persist('ABORT');
    if (!report) report = await h.synthesize(state, looked_at, state.gaps).catch(() => null) as DawnReport | null;
  }

  return { state, report, perPhaseTokens };
}
