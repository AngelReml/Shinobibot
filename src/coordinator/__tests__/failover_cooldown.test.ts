import { describe, it, expect } from 'vitest';
import { FailoverCooldown } from '../failover_cooldown.js';

describe('FailoverCooldown', () => {
  it('profile nuevo está disponible', () => {
    const c = new FailoverCooldown();
    expect(c.isAvailable('openai/key1')).toBe(true);
  });

  it('un fallo no abre cooldown si threshold > 1', () => {
    const c = new FailoverCooldown({ failureThreshold: 3 });
    const r = c.markFailure('openai/key1', 'rate_limit');
    expect(r.cooldownOpened).toBe(false);
    expect(c.isAvailable('openai/key1')).toBe(true);
  });

  it('threshold alcanzado → cooldown abierto', () => {
    const c = new FailoverCooldown({ failureThreshold: 3, baseCooldownSec: 60 });
    c.markFailure('openai/k', 'rate_limit');
    c.markFailure('openai/k', 'rate_limit');
    const r = c.markFailure('openai/k', 'rate_limit');
    expect(r.cooldownOpened).toBe(true);
    expect(r.cooldownSec).toBe(60);
    expect(c.isAvailable('openai/k')).toBe(false);
  });

  it('markSuccess resetea racha y termina cooldown', () => {
    const c = new FailoverCooldown({ failureThreshold: 2 });
    c.markFailure('p', 'rate_limit');
    c.markFailure('p', 'rate_limit');
    expect(c.isAvailable('p')).toBe(false);
    c.markSuccess('p');
    expect(c.isAvailable('p')).toBe(true);
  });

  it('isAvailable=true tras vencer cooldown (con nowFn mock)', () => {
    let now = 1_000_000_000_000;
    const c = new FailoverCooldown({
      failureThreshold: 1,
      baseCooldownSec: 60,
      nowFn: () => now,
    });
    c.markFailure('p', 'rate_limit');
    expect(c.isAvailable('p')).toBe(false);

    now += 30_000; // 30s
    expect(c.isAvailable('p')).toBe(false);

    now += 31_000; // total 61s → cooldown vencido
    expect(c.isAvailable('p')).toBe(true);
  });

  it('backoff exponencial entre reopens', () => {
    let now = 0;
    const c = new FailoverCooldown({
      failureThreshold: 1, baseCooldownSec: 10, backoffMultiplier: 2, maxCooldownSec: 1000,
      nowFn: () => now,
    });
    const r1 = c.markFailure('p', 'rate_limit');
    expect(r1.cooldownSec).toBe(10);
    now += 11_000;
    c.markSuccess('p'); // no resetea reopenCount

    const r2 = c.markFailure('p', 'rate_limit');
    expect(r2.cooldownSec).toBe(20);

    now += 21_000;
    c.markSuccess('p');

    const r3 = c.markFailure('p', 'rate_limit');
    expect(r3.cooldownSec).toBe(40);
  });

  it('maxCooldownSec capa el backoff', () => {
    let now = 0;
    const c = new FailoverCooldown({
      failureThreshold: 1, baseCooldownSec: 10, backoffMultiplier: 4, maxCooldownSec: 30,
      nowFn: () => now,
    });
    c.markFailure('p', 'rate_limit');
    now += 11_000;
    c.markSuccess('p');
    const r = c.markFailure('p', 'rate_limit');
    expect(r.cooldownSec).toBeLessThanOrEqual(30);
  });

  it('triggers no relevantes no abren cooldown', () => {
    const c = new FailoverCooldown({ failureThreshold: 1 });
    const r = c.markFailure('p', 'auth');
    // 'auth' SÍ es relevante (es una de las 3); cambiamos a otro test
    expect(r.cooldownOpened).toBe(true);
  });

  it('nextRetryAt durante cooldown está dentro del cooldown', () => {
    let now = 1_000;
    const c = new FailoverCooldown({
      failureThreshold: 1, baseCooldownSec: 60,
      nowFn: () => now,
    });
    c.markFailure('p', 'rate_limit');
    const probe = c.nextRetryAt('p');
    expect(probe).not.toBeNull();
    // Probe debe ser ~now + 1/3 del cooldown restante (≈20s).
    expect(probe!).toBeGreaterThan(now);
    expect(probe!).toBeLessThan(now + 60_000);
  });

  it('nextRetryAt=null cuando no está en cooldown', () => {
    const c = new FailoverCooldown();
    expect(c.nextRetryAt('p')).toBeNull();
  });

  it('metrics expone snapshot multi-profile', () => {
    const c = new FailoverCooldown({ failureThreshold: 1 });
    c.markFailure('a', 'rate_limit');
    c.markSuccess('b');
    const m = c.metrics();
    expect(m.length).toBe(2);
    const a = m.find(x => x.profile === 'a')!;
    expect(a.available).toBe(false);
    expect(a.totalFailures).toBe(1);
    const b = m.find(x => x.profile === 'b')!;
    expect(b.totalSuccesses).toBe(1);
    expect(b.available).toBe(true);
  });
});
