import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { humanizeError, formatHumanError, humanErrorsEnabled } from '../human_errors.js';

describe('humanizeError', () => {
  it('translates ECONNREFUSED', () => {
    const h = humanizeError('connect ECONNREFUSED 127.0.0.1:3333');
    expect(h.message).toContain('conectar');
    expect(h.raw).toContain('ECONNREFUSED');
  });

  it('translates timeout', () => {
    const h = humanizeError('Request timed out after 30000ms');
    expect(h.message).toContain('tardó');
  });

  it('translates 401 / api key', () => {
    const h = humanizeError('Error 401: invalid api_key');
    expect(h.message).toContain('API');
  });

  it('translates ENOENT', () => {
    const h = humanizeError("ENOENT: no such file or directory, open '/some/path'");
    expect(h.message).toContain('directorio');
  });

  it('translates rate limit (429)', () => {
    const h = humanizeError('429 Too Many Requests');
    expect(h.message).toContain('saturado');
  });

  it('translates context length error', () => {
    const h = humanizeError('context_length_exceeded: too many tokens in request');
    expect(h.message).toContain('conversación');
  });

  it('translates module not found', () => {
    const h = humanizeError("Cannot find module './foo' from 'src/index.ts'");
    expect(h.message).toContain('componente');
  });

  it('translates JSON parse error', () => {
    const h = humanizeError('SyntaxError: Unexpected token < in JSON at position 0');
    expect(h.message).toContain('formato');
  });

  it('falls back gracefully for unknown errors', () => {
    const h = humanizeError('XYZ_WEIRD_ERROR: something truly unusual happened');
    expect(h.message).toBeTruthy();
    expect(h.raw).toContain('XYZ_WEIRD_ERROR');
  });

  it('strips stack trace from fallback (only first line)', () => {
    const multi = 'SomeCustomError: bad thing\n    at Object.<anonymous> (file.ts:10:5)';
    const h = humanizeError(multi);
    expect(h.message).not.toContain('at Object');
  });

  it('formatHumanError appends hint', () => {
    const h = humanizeError('ECONNREFUSED');
    const s = formatHumanError(h);
    expect(s).toContain('Comprueba');
  });
});

describe('humanErrorsEnabled', () => {
  const orig = process.env.SHINOBI_HUMAN_ERRORS;
  afterEach(() => {
    if (orig === undefined) delete process.env.SHINOBI_HUMAN_ERRORS;
    else process.env.SHINOBI_HUMAN_ERRORS = orig;
  });

  it('is enabled by default', () => {
    delete process.env.SHINOBI_HUMAN_ERRORS;
    expect(humanErrorsEnabled()).toBe(true);
  });

  it('is disabled when SHINOBI_HUMAN_ERRORS=0', () => {
    process.env.SHINOBI_HUMAN_ERRORS = '0';
    expect(humanErrorsEnabled()).toBe(false);
  });

  it('passes raw message through when disabled', () => {
    process.env.SHINOBI_HUMAN_ERRORS = '0';
    const h = humanizeError('ECONNREFUSED');
    expect(h.message).toBe('ECONNREFUSED');
    expect(h.raw).toBe('ECONNREFUSED');
  });
});
