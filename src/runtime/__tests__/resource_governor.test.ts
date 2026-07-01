// src/runtime/__tests__/resource_governor.test.ts
//
// Tests del motor E8 (governor). Pure cores + invariante de concurrencia real.
// Cero imports pesados → corre en cualquier plataforma.

import { describe, it, expect, vi } from 'vitest';
import {
  effectiveWidth, decideAdmission, ResourceGovernor, GovernorShedError,
  type GovernorConfig, type AdmissionState,
} from '../resource_governor.js';

const cfg: GovernorConfig = { maxConcurrency: 8, perTenantCap: 3, maxQueue: 1000, minConcurrency: 2 };

describe('effectiveWidth — ancho adaptativo (no colapsa el PC)', () => {
  it('load=0 → máximo; load=1 → suelo; intermedio entre ambos', () => {
    expect(effectiveWidth(cfg, 0)).toBe(8);
    expect(effectiveWidth(cfg, 1)).toBe(2);
    expect(effectiveWidth(cfg, 0.5)).toBe(5);
  });
  it('clampa load fuera de rango', () => {
    expect(effectiveWidth(cfg, -5)).toBe(8);
    expect(effectiveWidth(cfg, 9)).toBe(2);
  });
});

describe('decideAdmission — run / queue / shed', () => {
  const st = (running: number, queued: number, tenantN = 0): AdmissionState => ({
    running, queued, perTenant: new Map(tenantN ? [['op', tenantN]] : []),
  });
  it('corre si hay ancho y el operador está bajo su cap', () => {
    expect(decideAdmission(st(0, 0), 'op', cfg, 8)).toBe('run');
  });
  it('encola si no hay ancho pero la cola no está llena', () => {
    expect(decideAdmission(st(8, 0), 'op', cfg, 8)).toBe('queue');
  });
  it('encola si el operador alcanzó su cap (equidad) aunque haya ancho', () => {
    expect(decideAdmission(st(3, 0, 3), 'op', cfg, 8)).toBe('queue');
  });
  it('rechaza (shed) si la cola está llena', () => {
    expect(decideAdmission(st(8, 1000), 'op', cfg, 8)).toBe('shed');
  });
});

describe('ResourceGovernor — el centro no se pierde bajo presión (刃 sobre 心)', () => {
  it('flood de 200 req / 5 operadores: nunca supera el cap ni la equidad, y todas completan', async () => {
    const g = new ResourceGovernor(cfg);
    let cur = 0, maxRunning = 0, maxPerTenant = 0, completed = 0;
    const work = (t: string) => async () => {
      cur++; maxRunning = Math.max(maxRunning, cur);
      maxPerTenant = Math.max(maxPerTenant, g.snapshot().perTenant[t] ?? 0);
      await new Promise((r) => setTimeout(r, 2 + Math.floor(Math.random() * 6)));
      cur--; completed++; return 1;
    };
    const ps: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) { const t = 'op' + (i % 5); ps.push(g.run(t, work(t)).catch(() => {})); }
    await Promise.all(ps);
    expect(maxRunning).toBeLessThanOrEqual(8);
    expect(maxPerTenant).toBeLessThanOrEqual(3);
    expect(completed).toBe(200);
  });

  it('backpressure: con cola pequeña, rechaza el exceso y solo corre lo admitido', async () => {
    const g = new ResourceGovernor({ maxConcurrency: 2, perTenantCap: 2, maxQueue: 10, minConcurrency: 1 });
    let shed = 0, success = 0;
    const slow = () => new Promise((r) => setTimeout(() => r(1), 30));
    const ps: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      ps.push(g.run('op' + (i % 2), slow).then(() => { success++; }, (e) => { if (e instanceof GovernorShedError) shed++; }));
    }
    await Promise.all(ps);
    expect(success).toBe(12);     // 2 corriendo + 10 en cola
    expect(shed).toBe(188);
    expect(success + shed).toBe(200);
  });

  it('propaga el error de la unidad de trabajo (no lo traga) y libera el slot', async () => {
    const g = new ResourceGovernor(cfg);
    await expect(g.run('op', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(g.snapshot().running).toBe(0);
  });
});

// Regresión MEDIA-13 / BAJA-01 (auditoría 2026-07-01).
describe('ResourceGovernor — invariantes de config (MEDIA-13 / BAJA-01)', () => {
  it('MEDIA-13: minConcurrency > maxConcurrency se clampea, no viola el cap duro', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = new ResourceGovernor({ maxConcurrency: 2, perTenantCap: 5, maxQueue: 10, minConcurrency: 8 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    // effectiveWidth(load=1) usa minConcurrency — con el bug retornaría 8 (> cap duro de 2).
    expect(effectiveWidth((g as any).cfg, 1)).toBeLessThanOrEqual(2);
  });

  it('MEDIA-13: no muta el objeto de config original del caller', () => {
    const original: GovernorConfig = { maxConcurrency: 2, perTenantCap: 5, maxQueue: 10, minConcurrency: 8 };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new ResourceGovernor(original);
    warnSpy.mockRestore();
    expect(original.minConcurrency).toBe(8); // el caller no ve su objeto mutado
  });

  it('BAJA-01: perTenantCap=0 avisa que ninguna tarea será admitida (deadlock diagnosticable)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new ResourceGovernor({ maxConcurrency: 4, perTenantCap: 0, maxQueue: 10, minConcurrency: 1 });
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('perTenantCap=0'))).toBe(true);
    warnSpy.mockRestore();
  });
});
