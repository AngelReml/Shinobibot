import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runNightCycle, shouldRunNightCycle, nightCycleEnabled, chooseNightlyChannels,
  NightCycleDisabledError, NIGHT_CYCLE_TRIGGER,
} from '../night_cycle.js';
import { KangeikoStore } from '../../kangeiko/store.js';
import type { RunKagemushaResult } from '../../kagemusha/trigger.js';
import type { AsyncSynthesizer } from '../../kangeiko/fabricate_async.js';

const ENV_KEYS = ['SHINOBI_NIGHT_CYCLE_ENABLED', 'KAGEMUSHA_ENABLED', 'SHINOBI_KAGEMUSHA_CHANNELS', 'SHINOBI_NIGHT_BUDGET_USD', 'SHINOBI_SYNTH_LLM'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeKagemushaResult(overrides: Partial<RunKagemushaResult> = {}): RunKagemushaResult {
  return {
    state: {
      mission_id: 'night_test', phase: 'DONE', spec: { channels: [], budget: { maxDepth: 2, maxThreads: 10, maxTokens: 50000, maxWallClockMs: 1000, minRelevance: 0.3 }, models: { bulk: '', judge: '' } },
      frontier: [], visited: [], threadsOpened: 3, tokensSpent: 100, startedAt: 't0', updatedAt: 't1', gaps: [],
    },
    report: {
      report_id: 'r1', mission_id: 'night_test', generated_at: 't1',
      looked_at: { channels: 0, transcripts: 0, threads: 3 },
      highlights: [], discarded: [], build_suggestions: [], gaps: ['hueco de ejemplo'],
      integrity: { fabrication_flags: 0, unverified_excluded: 0 },
    },
    perPhaseTokens: {},
    reportPath: '/fake/reports/night_test.md',
    ...overrides,
  };
}

const honestSynth: AsyncSynthesizer<number, number> = { synthesize: async () => (x) => x * 2 };
const cheatSynth: AsyncSynthesizer<number, number> = {
  synthesize: async (train) => { const m = new Map(train.map((t) => [t.input, t.expected])); return (x) => (m.get(x) ?? -1); },
};

describe('nightCycleEnabled — gate propio', () => {
  it('off por defecto', () => { delete process.env.SHINOBI_NIGHT_CYCLE_ENABLED; expect(nightCycleEnabled()).toBe(false); });
  it('on con "1"', () => { process.env.SHINOBI_NIGHT_CYCLE_ENABLED = '1'; expect(nightCycleEnabled()).toBe(true); });
});

describe('chooseNightlyChannels — kagemusha elige él mismo los temas', () => {
  it('sin env var: [] — self-directed, no bloquea, continúa sobre su propio grafo', () => {
    delete process.env.SHINOBI_KAGEMUSHA_CHANNELS;
    expect(chooseNightlyChannels()).toEqual([]);
  });
  it('con env var: parsea la lista separada por comas', () => {
    process.env.SHINOBI_KAGEMUSHA_CHANNELS = '@a, @b ,@c';
    expect(chooseNightlyChannels()).toEqual(['@a', '@b', '@c']);
  });
});

describe('shouldRunNightCycle — cron 2am (reutiliza mission_scheduler.isDue)', () => {
  it('debido a las 02:00 sin run previo', () => {
    expect(shouldRunNightCycle(null, new Date('2026-07-06T02:00:00'))).toBe(true);
  });
  it('NO debido a otra hora', () => {
    expect(shouldRunNightCycle(null, new Date('2026-07-06T14:00:00'))).toBe(false);
  });
  it('NO se re-dispara en el mismo minuto ya corrido', () => {
    const now = new Date('2026-07-06T02:00:00');
    expect(shouldRunNightCycle(now.toISOString(), now)).toBe(false);
  });
  it('vuelve a ser debido la noche siguiente', () => {
    expect(shouldRunNightCycle('2026-07-05T02:00:00.000Z', new Date('2026-07-06T02:00:00'))).toBe(true);
  });
});

describe('runNightCycle — gate propio', () => {
  it('lanza NightCycleDisabledError si SHINOBI_NIGHT_CYCLE_ENABLED no es 1', async () => {
    delete process.env.SHINOBI_NIGHT_CYCLE_ENABLED;
    await expect(runNightCycle()).rejects.toThrow(NightCycleDisabledError);
  });
});

describe('runNightCycle — orquestación completa (todo inyectado, determinista)', () => {
  let reportsDir: string;
  let store: KangeikoStore;

  beforeEach(() => {
    process.env.SHINOBI_NIGHT_CYCLE_ENABLED = '1';
    reportsDir = tmpDir('night_reports_');
    store = new KangeikoStore({ db_path: path.join(tmpDir('night_db_'), 'kk.db') });
  });
  afterEach(() => { store.close(); });

  it('kagemusha desactivado ⇒ se omite con razón honesta, kangeiko sigue intentando', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, now: () => 1000 });
    expect(r.kagemusha.ran).toBe(false);
    expect(r.kagemusha.reason).toMatch(/KAGEMUSHA_ENABLED/);
    expect(r.kangeiko.attempted).toBe(true);
  });

  it('kagemusha habilitado + runner inyectado ⇒ corre y suma coste estimado al gasto', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    const runner = async () => fakeKagemushaResult();
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, kagemushaRunner: runner, now: () => 1000 });
    expect(r.kagemusha.ran).toBe(true);
    expect(r.kagemusha.threadsInvestigated).toBe(3);
    expect(r.kagemusha.gaps).toBe(1);
    expect(r.spentUsd).toBeGreaterThan(0);
  });

  it('síntesis HONESTA certificada ⇒ decideAdoption=auto_keep ⇒ se guarda sola en el repertorio de Kangeiko', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, now: () => 42 });
    expect(r.kangeiko.certified).toBe(true);
    expect(r.kangeiko.verdict).toBe('auto_keep');
    expect(r.kangeiko.adopted).toBe(true);
    const rep = store.listRepertoire('active');
    expect(rep.some((e) => e.capability_id === 'double_number')).toBe(true);
  });

  it('síntesis TRAMPOSA (memoriza train) ⇒ NO certifica ⇒ NO se adopta (anti reward-hacking end-to-end)', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    const r = await runNightCycle({ synth: cheatSynth, store, reportsDir, now: () => 43 });
    expect(r.kangeiko.certified).toBe(false);
    expect(r.kangeiko.adopted).toBe(false);
    expect(store.listRepertoire('active').length).toBe(0);
  });

  it('SHINOBI_SYNTH_LLM se enciende SOLO durante la fabricación y se restaura después', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    delete process.env.SHINOBI_SYNTH_LLM;
    let sawFlagOn = false;
    const probeSynth: AsyncSynthesizer<number, number> = {
      synthesize: async (train) => {
        sawFlagOn = process.env.SHINOBI_SYNTH_LLM === '1';
        return honestSynth.synthesize(train);
      },
    };
    await runNightCycle({ synth: probeSynth, store, reportsDir, now: () => 44 });
    expect(sawFlagOn).toBe(true);
    expect(process.env.SHINOBI_SYNTH_LLM).toBeUndefined(); // restaurado
  });

  it('presupuesto agotado por kagemusha ⇒ kangeiko se omite (fail-closed, no gasta de más)', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    process.env.SHINOBI_NIGHT_BUDGET_USD = '0.01'; // techo minúsculo
    const runner = async () => fakeKagemushaResult({ state: { ...fakeKagemushaResult().state, tokensSpent: 100_000 } });
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, kagemushaRunner: runner, now: () => 1000 });
    expect(r.kangeiko.attempted).toBe(false);
    expect(r.kangeiko.reason).toMatch(/presupuesto/);
    expect(r.budgetStoppedEarly).toBe(true);
  });

  it('kagemusha que lanza ⇒ no revienta el ciclo, se refleja como fallo y kangeiko sigue', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    const runner = async () => { throw new Error('fallo de red simulado'); };
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, kagemushaRunner: runner, now: () => 1000 });
    expect(r.kagemusha.ran).toBe(false);
    expect(r.kagemusha.reason).toMatch(/fallo de red simulado/);
    expect(r.kangeiko.attempted).toBe(true);
  });

  it('deja SIEMPRE un informe del amanecer en fichero', async () => {
    delete process.env.KAGEMUSHA_ENABLED;
    const r = await runNightCycle({ synth: honestSynth, store, reportsDir, now: () => 45 });
    expect(fs.existsSync(r.reportPath)).toBe(true);
    const md = fs.readFileSync(r.reportPath, 'utf-8');
    expect(md).toContain('Informe del Amanecer');
    expect(md).toContain('Presupuesto');
  });
});
