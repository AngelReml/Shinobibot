import { describe, it, expect } from 'vitest';
import {
  classifyProviderError,
  shouldFailover,
  buildFailoverChain,
  reasonLabel,
} from '../failover.js';

describe('classifyProviderError', () => {
  it('detecta no_key', () => {
    expect(classifyProviderError('Groq: SHINOBI_PROVIDER_KEY no está definida.')).toBe('no_key');
    expect(classifyProviderError('Missing API key')).toBe('no_key');
    expect(classifyProviderError('api key not set')).toBe('no_key');
  });
  it('detecta rate_limit', () => {
    expect(classifyProviderError('OpenAI: rate limit exceeded')).toBe('rate_limit');
    expect(classifyProviderError('HTTP 429: Too Many Requests')).toBe('rate_limit');
    expect(classifyProviderError('Quota exceeded for project')).toBe('rate_limit');
  });
  it('detecta transient', () => {
    expect(classifyProviderError('connection error: ECONNREFUSED')).toBe('transient');
    expect(classifyProviderError('Error: ENOTFOUND api.x.com')).toBe('transient');
    expect(classifyProviderError('socket hang up')).toBe('transient');
    expect(classifyProviderError('HTTP 503 Service Unavailable')).toBe('transient');
    expect(classifyProviderError('gateway timeout')).toBe('transient');
  });
  it('detecta auth', () => {
    expect(classifyProviderError('Groq HTTP 401: key inválida.')).toBe('auth');
    expect(classifyProviderError('Unauthorized: invalid credentials')).toBe('auth');
  });
  it('detecta fatal_payload', () => {
    expect(classifyProviderError('HTTP 400: Invalid tool schema for function X')).toBe('fatal_payload');
    expect(classifyProviderError('HTTP 400: messages[2].role must be one of user|assistant')).toBe('fatal_payload');
  });
  it('default → unknown', () => {
    expect(classifyProviderError('Something exploded')).toBe('unknown');
    expect(classifyProviderError(undefined)).toBe('unknown');
    expect(classifyProviderError('')).toBe('unknown');
  });
  it('un número 5xx suelto sin contexto HTTP no se clasifica como transient', () => {
    expect(classifyProviderError('processed 512 records before failing')).toBe('unknown');
    expect(classifyProviderError('queue length 503')).toBe('unknown');
  });
});

describe('shouldFailover', () => {
  it('rota todo excepto fatal_payload', () => {
    expect(shouldFailover('rate_limit')).toBe(true);
    expect(shouldFailover('transient')).toBe(true);
    expect(shouldFailover('auth')).toBe(true);
    expect(shouldFailover('no_key')).toBe(true);
    expect(shouldFailover('unknown')).toBe(true);
    expect(shouldFailover('fatal_payload')).toBe(false);
  });
});

describe('buildFailoverChain', () => {
  it('default: current al frente y sin duplicados', () => {
    const c = buildFailoverChain('opengravity');
    expect(c[0]).toBe('opengravity');
    expect(new Set(c).size).toBe(c.length);
    expect(c).toContain('openrouter');
    expect(c).toContain('groq');
  });
  it('current=groq queda al frente', () => {
    const c = buildFailoverChain('groq');
    expect(c[0]).toBe('groq');
    expect(c.indexOf('groq')).toBe(c.lastIndexOf('groq'));
  });
  it('SHINOBI_FAILOVER_CHAIN respetada', () => {
    const c = buildFailoverChain('groq', 'anthropic,openai,groq,openrouter');
    expect(c[0]).toBe('groq');
    expect(c).toContain('anthropic');
    expect(c).toContain('openai');
    expect(c).toContain('openrouter');
    expect(c.indexOf('groq')).toBe(c.lastIndexOf('groq'));
  });
  it('descarta nombres inválidos', () => {
    const c = buildFailoverChain('groq', 'invalid_provider,opensource,groq');
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0]).toBe('groq');
  });
  it('current se prepone si no estaba en env chain', () => {
    const c = buildFailoverChain('groq', 'anthropic,openai');
    expect(c[0]).toBe('groq');
    expect(c).toContain('anthropic');
    expect(c).toContain('openai');
  });
});

describe('reasonLabel', () => {
  it('produce etiqueta legible', () => {
    expect(reasonLabel('no_key')).toContain('key');
    expect(reasonLabel('rate_limit')).toContain('rate');
    expect(reasonLabel('transient')).toContain('transitorio');
    expect(reasonLabel('auth')).toContain('auth');
    expect(reasonLabel('fatal_payload')).toContain('payload');
    expect(reasonLabel('unknown')).toContain('desconocido');
  });
});
