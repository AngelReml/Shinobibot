/**
 * M-11 — dynamic probe: launch→UIA→classify→close. Live seams injected; the gates
 * (no dangerous launch, always-close, honest degradation) are deterministic.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyUia, probeDynamic, type ProbeDeps } from '../characterize/probe.js';

const okDeps = (obs = { control_count: 20, named_ratio: 0.8 }): ProbeDeps => ({
  launch: async () => ({ handle: 'h1' }),
  observe: async () => obs,
  close: async () => {},
});

describe('chizu — M-11 sondeo dinámico', () => {
  it('classifyUia: rico/pobre/opaco según controles nombrados', () => {
    expect(classifyUia({ control_count: 20, named_ratio: 0.8 })).toBe('rich');
    expect(classifyUia({ control_count: 5, named_ratio: 0.3 })).toBe('poor');
    expect(classifyUia({ control_count: 1, named_ratio: 0 })).toBe('opaque');
    expect(classifyUia(null)).toBe('opaque');
  });

  it('app safe → lanza, observa, clasifica y SIEMPRE cierra', async () => {
    const close = vi.fn(async () => {});
    const r = await probeDynamic({ app_id: 'a', command: 'app.exe', risk_level: 'safe' }, { ...okDeps(), close });
    expect(r.launched).toBe(true); expect(r.uia).toBe('rich');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('GATED: app dangerous/forbidden NO se lanza (documentado)', async () => {
    const launch = vi.fn(async () => ({ handle: 'h' }));
    const r = await probeDynamic({ app_id: 'bank', command: 'bank.exe', risk_level: 'dangerous' }, { ...okDeps(), launch });
    expect(launch).not.toHaveBeenCalled();
    expect(r.launched).toBe(false); expect(r.note).toMatch(/gated/);
  });

  it('si observe casca, degrada a opaque pero CIERRA igual (no fabrica rich)', async () => {
    const close = vi.fn(async () => {});
    const r = await probeDynamic({ app_id: 'a', command: 'a.exe', risk_level: 'caution' },
      { launch: async () => ({ handle: 'h' }), observe: async () => { throw new Error('uia timeout'); }, close });
    expect(r.uia).toBe('opaque'); expect(r.launched).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);            // always closed
  });

  it('si no lanza, unprobed honesto (no inventa)', async () => {
    const r = await probeDynamic({ app_id: 'a', command: 'a.exe', risk_level: 'safe' },
      { launch: async () => { throw new Error('no existe'); }, observe: async () => ({ control_count: 0, named_ratio: 0 }), close: async () => {} });
    expect(r.uia).toBe('unprobed'); expect(r.launched).toBe(false);
  });
});
