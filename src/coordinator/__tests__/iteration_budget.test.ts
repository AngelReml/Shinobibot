import { describe, it, expect } from 'vitest';
import { IterationBudget, withBudget } from '../iteration_budget.js';

describe('IterationBudget', () => {
  it('consume decrementa remaining', () => {
    const b = new IterationBudget(10);
    expect(b.remaining()).toBe(10);
    expect(b.consume()).toBe(true);
    expect(b.remaining()).toBe(9);
    b.consume(3);
    expect(b.remaining()).toBe(6);
  });

  it('consume devuelve false cuando se agota', () => {
    const b = new IterationBudget(2);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
    expect(b.consume()).toBe(false); // sigue devolviendo false
  });

  it('free_turn no afecta remaining', () => {
    const b = new IterationBudget(5);
    b.free_turn();
    b.free_turn(2);
    expect(b.remaining()).toBe(5);
    expect(b.snapshot().free).toBe(3);
  });

  it('refund añade tokens al pool', () => {
    const b = new IterationBudget(5);
    b.consume(3);
    expect(b.remaining()).toBe(2);
    b.refund(2);
    expect(b.remaining()).toBe(4);
  });

  it('rechaza total inválido', () => {
    expect(() => new IterationBudget(0)).toThrow();
    expect(() => new IterationBudget(-5)).toThrow();
    expect(() => new IterationBudget(NaN)).toThrow();
  });

  it('snapshot devuelve estado completo', () => {
    const b = new IterationBudget(10);
    b.consume(3);
    b.free_turn();
    b.refund(1);
    const s = b.snapshot();
    expect(s.total).toBe(10);
    expect(s.used).toBe(3);
    expect(s.remaining).toBe(8);
    expect(s.free).toBe(1);
    expect(s.refunded).toBe(1);
  });
});

describe('IterationBudget — sub-budgets', () => {
  it('spawnChild crea hijo con cap acotado al remaining del padre', () => {
    const parent = new IterationBudget(10);
    parent.consume(3);
    const child = parent.spawnChild(20); // intenta pedir 20, máx posible = 7
    expect(child.snapshot().total).toBe(7);
  });

  it('cierre del hijo descuenta lo consumido al padre', () => {
    const parent = new IterationBudget(10);
    const child = parent.spawnChild(5);
    child.consume(3);
    parent.closeChild(child);
    expect(parent.snapshot().used).toBe(3);
    expect(parent.remaining()).toBe(7);
  });

  it('hijo no usado no afecta al padre', () => {
    const parent = new IterationBudget(10);
    const child = parent.spawnChild(5);
    parent.closeChild(child);
    expect(parent.snapshot().used).toBe(0);
    expect(parent.remaining()).toBe(10);
  });

  it('hijo agotado dispara false en consume sin afectar al padre hasta closeChild', () => {
    const parent = new IterationBudget(10);
    const child = parent.spawnChild(2);
    expect(child.consume()).toBe(true);
    expect(child.consume()).toBe(true);
    expect(child.consume()).toBe(false);
    expect(parent.snapshot().used).toBe(0); // todavía no se cerró
    parent.closeChild(child);
    expect(parent.snapshot().used).toBe(2);
  });

  it('spawnChild lanza si el padre no tiene budget', () => {
    const parent = new IterationBudget(2);
    parent.consume(2);
    expect(() => parent.spawnChild(1)).toThrow();
  });

  it('múltiples hijos secuenciales acumulan en el padre', () => {
    const parent = new IterationBudget(20);
    for (let i = 0; i < 3; i++) {
      const c = parent.spawnChild(4);
      c.consume(3);
      parent.closeChild(c);
    }
    expect(parent.snapshot().used).toBe(9);
    expect(parent.remaining()).toBe(11);
  });
});

describe('withBudget helper', () => {
  it('ejecuta fn y devuelve resultado + snapshot', async () => {
    const { result, budget } = await withBudget(5, async (b) => {
      b.consume();
      b.consume();
      return 'done';
    });
    expect(result).toBe('done');
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(3);
  });
});
