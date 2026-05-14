import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressTracker, MockProgressJudge, LLMProgressJudge, progressDetectionEnabled } from '../progress_judge.js';

beforeEach(() => {
  delete process.env.SHINOBI_PROGRESS_DETECTION;
  delete process.env.SHINOBI_PROGRESS_JUDGE;
});
afterEach(() => {
  delete process.env.SHINOBI_PROGRESS_DETECTION;
  delete process.env.SHINOBI_PROGRESS_JUDGE;
});

describe('progressDetectionEnabled', () => {
  it('default OFF', () => {
    expect(progressDetectionEnabled()).toBe(false);
  });
  it('SHINOBI_PROGRESS_DETECTION=1 → ON', () => {
    process.env.SHINOBI_PROGRESS_DETECTION = '1';
    expect(progressDetectionEnabled()).toBe(true);
  });
});

describe('LLMProgressJudge — parsing del modelo override', () => {
  it('default groq llama-3.3', () => {
    delete process.env.SHINOBI_PROGRESS_JUDGE;
    const j = new LLMProgressJudge();
    expect(j.id).toBe('llm:groq/llama-3.3-70b-versatile');
  });
  it('SHINOBI_PROGRESS_JUDGE=provider:model', () => {
    process.env.SHINOBI_PROGRESS_JUDGE = 'anthropic:claude-haiku-4.5';
    const j = new LLMProgressJudge();
    expect(j.id).toBe('llm:anthropic/claude-haiku-4.5');
  });
  it('SHINOBI_PROGRESS_JUDGE solo model → default provider groq', () => {
    process.env.SHINOBI_PROGRESS_JUDGE = 'mixtral-8x7b';
    const j = new LLMProgressJudge();
    expect(j.id).toBe('llm:groq/mixtral-8x7b');
  });
});

describe('MockProgressJudge', () => {
  it('devuelve scores en orden', async () => {
    const j = new MockProgressJudge([0.1, 0.3, 0.6]);
    expect(await j.score('g', 'o')).toBe(0.1);
    expect(await j.score('g', 'o')).toBe(0.3);
    expect(await j.score('g', 'o')).toBe(0.6);
  });
  it('al agotar, devuelve el último score', async () => {
    const j = new MockProgressJudge([0.5]);
    expect(await j.score('g', 'o')).toBe(0.5);
    expect(await j.score('g', 'o')).toBe(0.5);
    expect(await j.score('g', 'o')).toBe(0.5);
  });
  it('lista vacía → 0', async () => {
    const j = new MockProgressJudge([]);
    expect(await j.score('g', 'o')).toBe(0);
  });
});

describe('ProgressTracker — abort decisions', () => {
  it('menos de windowSize iteraciones → no aborta nunca', async () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.1, 0.1]) });
    const r1 = await t.recordIteration('g', 'o');
    const r2 = await t.recordIteration('g', 'o');
    expect(r1.abort).toBe(false);
    expect(r2.abort).toBe(false);
  });

  it('progreso lineal claro → no aborta', async () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.2, 0.45, 0.7, 0.9]) });
    for (let i = 0; i < 4; i++) {
      const r = await t.recordIteration('g', 'o');
      expect(r.abort).toBe(false);
    }
  });

  it('estancado debajo del doneThreshold → aborta con NO_SEMANTIC_PROGRESS', async () => {
    // Scores: 0.3 → 0.3 → 0.3. windowDelta = 0, minDelta default 0.05.
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.3, 0.3, 0.3]) });
    let last;
    for (let i = 0; i < 3; i++) last = await t.recordIteration('g', 'o');
    expect(last!.abort).toBe(true);
    expect(last!.verdict).toBe('NO_SEMANTIC_PROGRESS');
    expect(last!.reason).toContain('windowDelta');
  });

  it('estancado pero ARRIBA del doneThreshold → NO aborta', async () => {
    // El agente ya está cerca de terminar; un plateau ahí no es problema.
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.9, 0.9, 0.9]) });
    let last;
    for (let i = 0; i < 3; i++) last = await t.recordIteration('g', 'o');
    expect(last!.abort).toBe(false);
  });

  it('progreso lento PERO positivo (≥ minDelta) → no aborta', async () => {
    // 0.3 → 0.35 → 0.4 = delta 0.10 sobre 0.05.
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.3, 0.35, 0.4]) });
    let last;
    for (let i = 0; i < 3; i++) last = await t.recordIteration('g', 'o');
    expect(last!.abort).toBe(false);
  });

  it('regresión (delta negativo) → aborta', async () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.5, 0.4, 0.3]) });
    let last;
    for (let i = 0; i < 3; i++) last = await t.recordIteration('g', 'o');
    expect(last!.abort).toBe(true);
  });

  it('config personalizada: windowSize=5, minDelta=0.10', async () => {
    const t = new ProgressTracker({
      judge: new MockProgressJudge([0.3, 0.35, 0.4, 0.42, 0.44]),
      windowSize: 5,
      minDelta: 0.10,
    });
    let last;
    for (let i = 0; i < 5; i++) last = await t.recordIteration('g', 'o');
    // delta = 0.44 - 0.30 = 0.14 ≥ 0.10. No aborta.
    expect(last!.abort).toBe(false);
  });

  it('history_snapshot expone la historia completa', async () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.1, 0.2, 0.3]) });
    await t.recordIteration('g', 'first output');
    await t.recordIteration('g', 'second output');
    const snap = t.history_snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].score).toBe(0.1);
    expect(snap[1].score).toBe(0.2);
    expect(snap[0].iterationOutput).toContain('first');
  });

  it('iterationOutput se trunca a 200 chars en history', async () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([0.5]) });
    await t.recordIteration('g', 'x'.repeat(500));
    const snap = t.history_snapshot();
    expect(snap[0].iterationOutput.length).toBeLessThan(220);
    expect(snap[0].iterationOutput.endsWith('…')).toBe(true);
  });

  it('judgeId expone el judge activo', () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([]) });
    expect(t.judgeId()).toBe('mock');
  });

  it('recordScore (variante sin judge externo)', () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([]) });
    t.recordScore(0.2, 'turn-1');
    t.recordScore(0.3, 'turn-2');
    const r = t.recordScore(0.35, 'turn-3');
    expect(r.abort).toBe(false);
    expect(r.latestScore).toBe(0.35);
  });

  it('recordScore estancado → aborta', () => {
    const t = new ProgressTracker({ judge: new MockProgressJudge([]) });
    t.recordScore(0.3);
    t.recordScore(0.31);
    const r = t.recordScore(0.32);
    expect(r.abort).toBe(true);
  });
});
