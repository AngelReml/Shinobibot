import { describe, it, expect, beforeEach } from 'vitest';
import { anthropicRate } from '../pricing.js';
import { calculateCost } from '../orchestrator.js';
import { beginCostTurn, recordLlmUsage, sessionCost, describeCost, describeTurnCost, resetSessionCost } from '../session_cost.js';

describe('tarifas de Anthropic', () => {
  it('cada modelo actual tiene su tarifa; un id desconocido cae en su familia', () => {
    expect(anthropicRate('claude-opus-5-5')).toMatchObject({ input: 4, output: 20, cacheRead: 0.05 });
    expect(anthropicRate('claude-sonnet-5-5')).toMatchObject({ input: 2, output: 10, cacheRead: 0.05 });
    expect(anthropicRate('claude-fable-5-2')).toMatchObject({ input: 8, output: 40, cacheRead: 0.025 });
    expect(anthropicRate('claude-fable-5-1')).toMatchObject({ input: 10, output: 50 });
    expect(anthropicRate('claude-haiku-4-5')).toMatchObject({ input: 1, output: 5 });
    expect(anthropicRate('claude-opus-4-8')).toMatchObject({ input: 5, output: 25 });
  });

  it('Haiku 5.5 tiene dos tramos según el tamaño del prompt', () => {
    expect(anthropicRate('claude-haiku-5-5', 50_000)).toMatchObject({ input: 0.1, output: 0.5 });
    expect(anthropicRate('claude-haiku-5-5', 150_000)).toMatchObject({ input: 0.5, output: 2.5 });
  });

  it('calculateCost usa la tabla: 1M de entrada y 1M de salida en Opus 5.5 son 24 $', () => {
    expect(calculateCost('anthropic', 'claude-opus-5-5', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(24, 6);
    // 1M leído de caché en Opus 5.5: 5 % de 4 $ = 0,20 $
    expect(calculateCost('anthropic', 'claude-opus-5-5', { prompt_tokens: 1_000_000, completion_tokens: 0, cache_read_tokens: 1_000_000 })).toBeCloseTo(0.2, 6);
  });
});

describe('contador de gasto de la sesión', () => {
  beforeEach(() => resetSessionCost());

  it('vacío lo dice; suma por modelo, separa el último turno y se puede poner a cero', () => {
    expect(describeCost()).toMatch(/Todavía no hay llamadas/);
    expect(describeTurnCost()).toBe('');
    beginCostTurn('primer  mensaje');
    recordLlmUsage('anthropic', 'claude-opus-5-5', { prompt_tokens: 1000, completion_tokens: 100, cache_read_tokens: 400 }, 0.01);
    beginCostTurn('segundo');
    recordLlmUsage('anthropic', 'claude-opus-5-5', { prompt_tokens: 2000, completion_tokens: 50 }, 0.02);
    recordLlmUsage('anthropic', 'claude-haiku-5-5', { prompt_tokens: 500, completion_tokens: 10 }, 0.001);
    const c = sessionCost();
    expect(c.total).toMatchObject({ calls: 3, input: 3500, output: 160, cacheRead: 400 });
    expect(c.total.usd).toBeCloseTo(0.031, 6);
    expect(c.turn).toMatchObject({ calls: 2, input: 2500, output: 60 });
    expect(c.byModel['anthropic:claude-opus-5-5'].calls).toBe(2);
    const txt = describeCost();
    expect(txt).toContain('«segundo»');
    expect(txt).toContain('TOTAL');
    expect(describeTurnCost()).toMatch(/este turno: 2 llamadas/);
    resetSessionCost();
    expect(sessionCost().total.calls).toBe(0);
  });
});
