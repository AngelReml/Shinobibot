import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetTracker, tokenBudget, _resetTokenBudget } from '../token_budget.js';

describe('TokenBudgetTracker', () => {
  let tracker: TokenBudgetTracker;
  beforeEach(() => {
    tracker = new TokenBudgetTracker({ defaultBudget: 1000 });
  });

  it('recordTurn devuelve snapshot con usedTokens estimado', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x'.repeat(400) }, // ~100 tokens
    ];
    const snap = tracker.recordTurn('s1', msgs);
    expect(snap.sessionId).toBe('s1');
    expect(snap.usedTokens).toBeGreaterThan(50);
    expect(snap.budgetTokens).toBe(1000);
    expect(snap.ratio).toBeGreaterThan(0);
    expect(snap.turns).toBe(1);
    expect(typeof snap.lastTurnAt).toBe('string');
  });

  it('contador de turnos incrementa', () => {
    const msgs = [{ role: 'user', content: 'hi' }];
    tracker.recordTurn('s1', msgs);
    tracker.recordTurn('s1', msgs);
    const snap = tracker.recordTurn('s1', msgs);
    expect(snap.turns).toBe(3);
  });

  it('get devuelve copia (no muta interno)', () => {
    tracker.recordTurn('s1', [{ role: 'user', content: 'a' }]);
    const a = tracker.get('s1')!;
    a.usedTokens = 99999;
    const b = tracker.get('s1')!;
    expect(b.usedTokens).not.toBe(99999);
  });

  it('list devuelve todas las sesiones activas', () => {
    tracker.recordTurn('a', [{ role: 'user', content: 'x' }]);
    tracker.recordTurn('b', [{ role: 'user', content: 'y' }]);
    tracker.recordTurn('c', [{ role: 'user', content: 'z' }]);
    expect(tracker.list()).toHaveLength(3);
  });

  it('forget elimina la sesión', () => {
    tracker.recordTurn('s1', [{ role: 'user', content: 'x' }]);
    tracker.forget('s1');
    expect(tracker.get('s1')).toBeUndefined();
  });

  it('isNearCap detecta sesiones cerca del límite', () => {
    // ~3000 chars → ~750 tokens en budget 1000 = ratio 0.75
    tracker.recordTurn('low', [{ role: 'user', content: 'x'.repeat(500) }]);
    expect(tracker.isNearCap('low')).toBe(false);
    // ~3800 chars → ratio > 0.85
    tracker.recordTurn('high', [{ role: 'user', content: 'x'.repeat(3800) }]);
    expect(tracker.isNearCap('high')).toBe(true);
  });

  it('isNearCap con sesión inexistente devuelve false', () => {
    expect(tracker.isNearCap('nope')).toBe(false);
  });

  it('ratio se redondea a 3 decimales', () => {
    const snap = tracker.recordTurn('s1', [{ role: 'user', content: 'x'.repeat(100) }]);
    // ratio debe ser un número con como mucho 3 decimales
    expect(snap.ratio).toBe(Number(snap.ratio.toFixed(3)));
  });
});

describe('tokenBudget singleton', () => {
  beforeEach(() => {
    _resetTokenBudget();
    delete process.env.SHINOBI_CONTEXT_BUDGET;
  });

  it('singleton consistente', () => {
    const a = tokenBudget();
    const b = tokenBudget();
    expect(a).toBe(b);
  });

  it('budget configurable via SHINOBI_CONTEXT_BUDGET', () => {
    process.env.SHINOBI_CONTEXT_BUDGET = '8000';
    _resetTokenBudget();
    const t = tokenBudget();
    const snap = t.recordTurn('s', [{ role: 'user', content: 'x' }]);
    expect(snap.budgetTokens).toBe(8000);
    delete process.env.SHINOBI_CONTEXT_BUDGET;
  });

  it('default 32000 si no hay env', () => {
    _resetTokenBudget();
    const t = tokenBudget();
    const snap = t.recordTurn('s', [{ role: 'user', content: 'x' }]);
    expect(snap.budgetTokens).toBe(32_000);
  });
});
