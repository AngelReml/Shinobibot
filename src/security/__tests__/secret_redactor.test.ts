import { describe, it, expect } from 'vitest';
import { redactSecrets, redactSecretsByLine, hasSecrets, _internal } from '../secret_redactor.js';

/**
 * Helpers que construyen strings de test EN RUNTIME para que el código
 * fuente NUNCA contenga el patrón completo de una clave. Esto evita
 * que GitHub Secret Scanning bloquee el push detectándolas como reales.
 */
function fakeOpenAIKey(): string { return 's' + 'k-' + 'a'.repeat(40); }
function fakeOpenAIProj(): string { return 's' + 'k-proj-' + 'B'.repeat(36); }
function fakeAnthropic(): string { return 's' + 'k-ant-api03-' + 'C'.repeat(36); }
function fakeGithubPAT(): string { return 'gh' + 'p_' + 'd'.repeat(36); }
function fakeGoogleAI(): string { return 'AI' + 'za' + 'E'.repeat(35); }
function fakeAWS(): string { return 'AK' + 'IA' + 'F'.repeat(16); }
function fakeSlack(): string { return 'xo' + 'xb-' + '1'.repeat(8) + '-' + '2'.repeat(8) + '-' + 'g'.repeat(20); }
function fakeStripe(): string { return 's' + 'k_test_' + 'h'.repeat(20); }
function fakeJWT(): string { return 'ey' + 'J' + 'i'.repeat(20) + '.' + 'j'.repeat(20) + '.' + 'k'.repeat(20); }
function fakeBearer(): string { return 'l'.repeat(40); }

describe('redactSecrets — proveedores conocidos', () => {
  it('OpenAI sk-...', () => {
    const key = fakeOpenAIKey();
    const r = redactSecrets(`mi key es ${key} y la uso ya`);
    expect(r.text).toContain('<REDACTED:openai-key>');
    expect(r.matches[0].kind).toBe('openai-key');
    expect(r.text).not.toContain(key);
  });

  it('OpenAI sk-proj-...', () => {
    const r = redactSecrets(`export OPENAI_API_KEY=${fakeOpenAIProj()}`);
    expect(r.matches.some(m => m.kind === 'openai-key' || m.kind === 'env-secret-assignment')).toBe(true);
  });

  it('Anthropic sk-ant-...', () => {
    const r = redactSecrets(`anthropic key: ${fakeAnthropic()}`);
    expect(r.matches.some(m => m.kind === 'anthropic-key')).toBe(true);
  });

  it('GitHub ghp_...', () => {
    const key = fakeGithubPAT();
    const r = redactSecrets(`GITHUB_TOKEN=${key}`);
    expect(r.matches.some(m => m.kind === 'github-token' || m.kind === 'env-secret-assignment')).toBe(true);
    expect(r.text).not.toContain(key);
  });

  it('Google AIza...', () => {
    const key = fakeGoogleAI();
    const r = redactSecrets(`export GOOGLE_API_KEY=${key}`);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.text).not.toContain(key);
  });

  it('AWS AKIA...', () => {
    const r = redactSecrets(`aws_access_key_id=${fakeAWS()}`);
    expect(r.matches.some(m => m.kind === 'aws-access-key' || m.kind === 'env-secret-assignment')).toBe(true);
  });

  it('Slack xoxb-...', () => {
    const r = redactSecrets(`SLACK_BOT_TOKEN=${fakeSlack()}`);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it('Stripe sk_test_...', () => {
    const r = redactSecrets(`stripe = ${fakeStripe()}`);
    expect(r.matches.some(m => m.kind === 'stripe-key')).toBe(true);
  });
});

describe('redactSecrets — patrones genéricos', () => {
  it('Bearer header', () => {
    const r = redactSecrets(`Authorization: Bearer ${fakeBearer()}`);
    expect(r.text).toContain('Bearer <REDACTED:bearer-token>');
  });

  it('URL token query param', () => {
    const tok = 'A1B2C3D4E5F6G7H8I9';
    const r = redactSecrets(`GET https://api.example.com/x?token=${tok}&format=json`);
    expect(r.text).toContain('?token=<REDACTED:url-token>');
    expect(r.text).toContain('&format=json');
  });

  it('Private key block', () => {
    const block = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA...',
      'AAA...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const r = redactSecrets(`before\n${block}\nafter`);
    expect(r.text).toContain('<REDACTED:private-key-block>');
    expect(r.text).not.toContain('MIIE');
  });

  it('JWT', () => {
    const r = redactSecrets(`cookie session=${fakeJWT()}`);
    expect(r.matches.some(m => m.kind === 'jwt')).toBe(true);
  });

  it('Env var assignment con nombre sospechoso', () => {
    const r = redactSecrets('SUPER_API_KEY=plainpassword123');
    expect(r.matches.some(m => m.kind === 'env-secret-assignment')).toBe(true);
    expect(r.text).toContain('SUPER_API_KEY=<REDACTED:env-secret-assignment>');
  });
});

describe('redactSecrets — NO redacta texto inocente', () => {
  it('texto normal no produce matches', () => {
    const r = redactSecrets('Esto es un texto normal sin claves. La fecha es 2026-05-15.');
    expect(r.matches).toEqual([]);
    expect(r.text).toBe('Esto es un texto normal sin claves. La fecha es 2026-05-15.');
  });

  it('palabra "secret" sola no es match', () => {
    const r = redactSecrets('el secret de la abuela es la receta del flan');
    expect(r.matches).toEqual([]);
  });
});

describe('redactSecrets — fingerprint', () => {
  it('mismo input → mismo fingerprint', () => {
    const key = fakeOpenAIKey();
    const a = redactSecrets(key).matches[0];
    const b = redactSecrets(key).matches[0];
    expect(a.hashFingerprint).toBe(b.hashFingerprint);
    expect(a.hashFingerprint).toHaveLength(8);
  });
  it('inputs distintos → fingerprints distintos', () => {
    const a = redactSecrets('s' + 'k-' + 'a'.repeat(40)).matches[0];
    const b = redactSecrets('s' + 'k-' + 'b'.repeat(40)).matches[0];
    expect(a.hashFingerprint).not.toBe(b.hashFingerprint);
  });
});

describe('redactSecretsByLine', () => {
  it('preserva saltos de línea', () => {
    const key = fakeOpenAIKey();
    const input = ['normal line', key, 'normal line again'].join('\n');
    const r = redactSecretsByLine(input);
    const lines = r.text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('normal line');
    expect(lines[1]).toContain('<REDACTED:');
    expect(lines[2]).toBe('normal line again');
  });

  it('reporta matches con offset global correcto', () => {
    const key = fakeOpenAIKey();
    const input = `aaa\n${key}\nbbb`;
    const r = redactSecretsByLine(input);
    expect(r.matches.length).toBe(1);
    // El secreto empieza tras "aaa\n" → offset 4.
    expect(r.matches[0].start).toBe(4);
  });
});

describe('hasSecrets', () => {
  it('true si encuentra al menos uno', () => {
    expect(hasSecrets(fakeOpenAIKey())).toBe(true);
  });
  it('false si no encuentra', () => {
    expect(hasSecrets('texto normal')).toBe(false);
  });
});

describe('_internal exports', () => {
  it('PATTERNS no vacío', () => {
    expect(_internal.PATTERNS.length).toBeGreaterThan(8);
  });
  it('placeholder usa el kind', () => {
    expect(_internal.placeholder('openai-key')).toBe('<REDACTED:openai-key>');
  });
});
