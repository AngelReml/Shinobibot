import { describe, it, expect, afterEach } from 'vitest';
import { nightBudgetExceeded, nightlyBudgetUsd, NIGHT_BUDGET_USD_DEFAULT } from '../night_budget.js';

describe('nightlyBudgetUsd — techo configurable, default $10', () => {
  afterEach(() => { delete process.env.SHINOBI_NIGHT_BUDGET_USD; });

  it('sin env var, usa el default', () => {
    expect(nightlyBudgetUsd()).toBe(NIGHT_BUDGET_USD_DEFAULT);
    expect(NIGHT_BUDGET_USD_DEFAULT).toBe(10);
  });

  it('SHINOBI_NIGHT_BUDGET_USD válido lo sobreescribe', () => {
    process.env.SHINOBI_NIGHT_BUDGET_USD = '25';
    expect(nightlyBudgetUsd()).toBe(25);
  });

  it('SHINOBI_NIGHT_BUDGET_USD inválido (no numérico, 0, negativo) cae al default', () => {
    process.env.SHINOBI_NIGHT_BUDGET_USD = 'not-a-number';
    expect(nightlyBudgetUsd()).toBe(NIGHT_BUDGET_USD_DEFAULT);
    process.env.SHINOBI_NIGHT_BUDGET_USD = '0';
    expect(nightlyBudgetUsd()).toBe(NIGHT_BUDGET_USD_DEFAULT);
    process.env.SHINOBI_NIGHT_BUDGET_USD = '-5';
    expect(nightlyBudgetUsd()).toBe(NIGHT_BUDGET_USD_DEFAULT);
  });
});

describe('nightBudgetExceeded — fail-closed', () => {
  it('gasto medible por debajo del techo ⇒ NO excedido', () => {
    expect(nightBudgetExceeded(5, 10)).toBe(false);
  });

  it('gasto medible en o por encima del techo ⇒ excedido', () => {
    expect(nightBudgetExceeded(10, 10)).toBe(true);
    expect(nightBudgetExceeded(15, 10)).toBe(true);
  });

  it('coste NO medible (undefined/null/NaN) ⇒ excedido SIEMPRE, aunque el techo sea generoso (fail-closed)', () => {
    expect(nightBudgetExceeded(undefined, 1000)).toBe(true);
    expect(nightBudgetExceeded(null, 1000)).toBe(true);
    expect(nightBudgetExceeded(NaN, 1000)).toBe(true);
    expect(nightBudgetExceeded(Infinity, 1000)).toBe(true);
  });

  it('usa nightlyBudgetUsd() como techo por defecto si no se pasa budgetUsd', () => {
    expect(nightBudgetExceeded(5)).toBe(false); // 5 < 10 default
    expect(nightBudgetExceeded(10)).toBe(true); // 10 >= 10 default
  });

  it('mutación de referencia: si el fail-closed se quitara, un coste NaN pasaría — este test lo pilla', () => {
    // Encadenado: NaN contamina cualquier suma futura (NaN + n = NaN), y
    // nightBudgetExceeded(NaN, ...) sigue devolviendo true — no hay forma de
    // "resetear" accidentalmente a gasto bajo tras una medición rota.
    let spent = 3;
    spent += NaN; // p.ej. una llamada cuyo coste no se pudo leer
    expect(nightBudgetExceeded(spent, 1000)).toBe(true);
  });
});
