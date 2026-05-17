import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyComplexity } from '../query_complexity.js';
import { route, pickModelForTier, isRouterEnabled, DEFAULT_MAPPING } from '../model_router.js';

beforeEach(() => {
  for (const k of [
    'SHINOBI_MODEL_ROUTER',
    'SHINOBI_ROUTER_TINY',
    'SHINOBI_ROUTER_SIMPLE',
    'SHINOBI_ROUTER_MEDIUM',
    'SHINOBI_ROUTER_COMPLEX',
    'SHINOBI_ROUTER_EXPERT',
  ]) delete process.env[k];
});
afterEach(() => {
  for (const k of [
    'SHINOBI_MODEL_ROUTER',
    'SHINOBI_ROUTER_TINY',
    'SHINOBI_ROUTER_SIMPLE',
    'SHINOBI_ROUTER_MEDIUM',
    'SHINOBI_ROUTER_COMPLEX',
    'SHINOBI_ROUTER_EXPERT',
  ]) delete process.env[k];
});

describe('classifyComplexity', () => {
  it('saludos → tiny', () => {
    expect(classifyComplexity('hola').tier).toBe('tiny');
    expect(classifyComplexity('gracias').tier).toBe('tiny');
    expect(classifyComplexity('ok').tier).toBe('tiny');
    expect(classifyComplexity('Hola!').tier).toBe('tiny');
  });

  it('preguntas simples → simple', () => {
    expect(classifyComplexity('qué es TypeScript').tier).toBe('simple');
    expect(classifyComplexity('cuándo se inventó Python').tier).toBe('simple');
  });

  it('debug/refactor → medium', () => {
    expect(classifyComplexity('debuggea este error en el módulo X').tier).toBe('medium');
    expect(classifyComplexity('refactoriza esta función').tier).toBe('medium');
    expect(classifyComplexity('escribe tests para la clase A').tier).toBe('medium');
  });

  it('comparativas + research → complex', () => {
    expect(classifyComplexity('compara Vue con React').tier).toBe('complex');
    expect(classifyComplexity('investiga el estado del arte en RAG').tier).toBe('complex');
  });

  it('security review / audit → expert', () => {
    expect(classifyComplexity('audita la seguridad de este repo').tier).toBe('expert');
    expect(classifyComplexity('analiza vulnerabilidades SQLi y XSS').tier).toBe('expert');
    expect(classifyComplexity('threat model de la API').tier).toBe('expert');
  });

  it('input largo sin keywords sube al menos a medium', () => {
    const long = 'a'.repeat(2000);
    expect(['medium', 'complex', 'expert']).toContain(classifyComplexity(long).tier);
  });

  it('contexto previo largo evita bajar a tiny', () => {
    const r = classifyComplexity('ok', { recentUserTurns: ['x'.repeat(1000), 'y'.repeat(900)] });
    expect(r.tier).toBe('simple');
  });

  it('signals devuelve trazas legibles', () => {
    const r = classifyComplexity('audita la seguridad de mi repo');
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals.some(s => /security|audit/.test(s))).toBe(true);
  });

  it('estimatedToolCalls detecta menciones', () => {
    const r = classifyComplexity('lee el archivo X y luego ejecuta el comando Y y busca en internet Z');
    expect(r.estimatedToolCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('isRouterEnabled', () => {
  it('default OFF', () => {
    expect(isRouterEnabled()).toBe(false);
  });
  it('SHINOBI_MODEL_ROUTER=1 → ON', () => {
    process.env.SHINOBI_MODEL_ROUTER = '1';
    expect(isRouterEnabled()).toBe(true);
  });
  it('SHINOBI_MODEL_ROUTER=0 → OFF', () => {
    process.env.SHINOBI_MODEL_ROUTER = '0';
    expect(isRouterEnabled()).toBe(false);
  });
});

describe('pickModelForTier', () => {
  it('defaults: tiny=groq, expert=opus', () => {
    expect(pickModelForTier('tiny').provider).toBe('groq');
    expect(pickModelForTier('expert').model).toContain('opus');
  });
  it('env override "provider:model"', () => {
    process.env.SHINOBI_ROUTER_MEDIUM = 'openai:gpt-4o-mini';
    expect(pickModelForTier('medium')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });
  it('env override solo model usa default provider', () => {
    process.env.SHINOBI_ROUTER_SIMPLE = 'llama-3.1-8b-instant';
    const r = pickModelForTier('simple');
    expect(r.provider).toBe(DEFAULT_MAPPING.simple.provider);
    expect(r.model).toBe('llama-3.1-8b-instant');
  });
});

describe('route', () => {
  it('OFF: devuelve currentModel y rationale lo indica', () => {
    const r = route({
      input: 'audita este repo en seguridad',
      currentModel: { provider: 'anthropic', model: 'claude-sonnet-4.6' },
    });
    expect(r.enabled).toBe(false);
    expect(r.choice.model).toBe('claude-sonnet-4.6');
    expect(r.rationale.some(s => /OFF/.test(s))).toBe(true);
    expect(r.tier).toBe('expert');  // tier se sigue calculando incluso si está OFF
  });

  it('ON: tier=tiny → groq', () => {
    process.env.SHINOBI_MODEL_ROUTER = '1';
    const r = route({ input: 'hola' });
    expect(r.enabled).toBe(true);
    expect(r.tier).toBe('tiny');
    expect(r.choice.provider).toBe('groq');
  });

  it('ON: tier=expert → opus', () => {
    process.env.SHINOBI_MODEL_ROUTER = '1';
    const r = route({ input: 'audita la seguridad de mi backend completo' });
    expect(r.tier).toBe('expert');
    expect(r.choice.model).toContain('opus');
  });

  it('ON: env override aplica', () => {
    process.env.SHINOBI_MODEL_ROUTER = '1';
    process.env.SHINOBI_ROUTER_TINY = 'openai:gpt-4o-mini';
    const r = route({ input: 'hola' });
    expect(r.choice).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('estimatedCostUsd > 0 para modelos conocidos', () => {
    process.env.SHINOBI_MODEL_ROUTER = '1';
    const r = route({ input: 'audita seguridad del repo' });
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });
});
