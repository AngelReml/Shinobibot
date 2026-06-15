import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMission, resumeMission, type PhaseHandlers } from '../mission/mission.js';
import { KagemushaStore } from '../store/store.js';
import type { DawnReport, MissionSpec } from '../types.js';

const dbPath = path.join(os.tmpdir(), `kg_mission_${process.pid}.db`);
const store = new KagemushaStore({ db_path: dbPath });
afterAll(() => { store.close(); for (const s of ['', '-wal', '-shm']) try { fs.rmSync(dbPath + s, { force: true }); } catch {} });

function mkReport(missionId: string, looked_at: DawnReport['looked_at'], gaps: string[]): DawnReport {
  return { report_id: 'r', mission_id: missionId, generated_at: 'now', looked_at, highlights: [], discarded: [], build_suggestions: [], gaps, integrity: { fabrication_flags: 0, unverified_excluded: 0 } };
}

function handlers(threadCalls: { remaining: number; costPerThread: number }): PhaseHandlers {
  let left = threadCalls.remaining;
  return {
    async ingest() { return { tokens: 10, transcripts: 5, channels: 2 }; },
    async analyze() { return { tokens: 20, seeds: 3 }; },
    async thread() { left--; return { tokens: threadCalls.costPerThread, moreSeeds: left > 0, investigated: 1 }; },
    async contrast() { return { tokens: 5 }; },
    async synthesize(state, looked_at, gaps) { return mkReport(state.mission_id, looked_at, gaps); },
  };
}

const spec = (maxTokens: number, maxThreads = 8): MissionSpec => ({ channels: ['@x'], budget: { maxDepth: 2, maxThreads, maxTokens, maxWallClockMs: 1e7, minRelevance: 0.3 }, models: { bulk: 'glm-4-flash', judge: '' } });

describe('C-19 — mission state machine end-to-end + per-phase cost', () => {
  it('runs INIT→…→DONE, reports cost per phase, report fiel a looked_at', async () => {
    const r = await runMission(spec(1000), store, handlers({ remaining: 3, costPerThread: 5 }), { missionId: 'm_full', ts: '2026-06-15T00:00:00Z' });
    expect(r.state.phase).toBe('DONE');
    expect(r.report).toBeTruthy();
    expect(r.report!.looked_at).toEqual({ channels: 2, transcripts: 5, threads: 3 });
    expect(r.perPhaseTokens.INGEST).toBe(10);
    expect(r.perPhaseTokens.ANALYZE).toBe(20);
    expect(r.perPhaseTokens.THREAD).toBe(15);   // 3 threads × 5
    expect(r.perPhaseTokens.CONTRAST).toBe(5);
  });
});

describe('C-20 — ABORT never produces silence (partial report with gaps)', () => {
  it('budget exhausted mid-THREAD → report still emitted, gaps recorded', async () => {
    // budget 40: ingest 10 + analyze 20 = 30; each thread 5 → after 2 threads = 40 → exhausted.
    const r = await runMission(spec(40), store, handlers({ remaining: 10, costPerThread: 5 }), { missionId: 'm_abort', ts: '2026-06-15T00:00:00Z' });
    expect(r.report).toBeTruthy();                       // NOT silence
    expect(r.report!.gaps.some((g) => /presupuesto/i.test(g))).toBe(true);
    expect(r.report!.gaps.some((g) => /contraste.*omitido/i.test(g))).toBe(true);
  });
});

describe('C-20 — resume from a persisted state', () => {
  it('a mission persisted at THREAD resumes to DONE', async () => {
    // First run to completion persists; then resume by id continues idempotently to DONE.
    await runMission(spec(1000), store, handlers({ remaining: 2, costPerThread: 5 }), { missionId: 'm_resume', ts: '2026-06-15T00:00:00Z' });
    const persisted = store.loadMissionState('m_resume');
    expect(persisted).toBeTruthy();
    const r = await resumeMission('m_resume', store, handlers({ remaining: 1, costPerThread: 5 }), '2026-06-15T01:00:00Z');
    expect(r.state.phase).toBe('DONE');
    expect(r.report).toBeTruthy();
  });
});
