// F1.1 — el comando hijo ya NO hereda process.env completo. Setea una
// "API key" falsa en el proceso de test, ejecuta un comando que la
// imprimiría si heredara el entorno completo, y confirma que NO aparece
// en el output.
import { describe, it, expect, afterEach } from 'vitest';
import { LocalBackend, buildSafeChildEnv, SAFE_ENV_ALLOWLIST } from '../local.js';

describe('F1.1 — LocalBackend no filtra variables de entorno fuera de la allowlist', () => {
  const KEY = 'FAKE_SUPER_SECRET_API_KEY_FOR_TEST';
  afterEach(() => { delete process.env[KEY]; delete process.env.SHINOBI_RUN_ENV_EXTRA_ALLOWLIST; });

  it('buildSafeChildEnv omite una variable arbitraria no listada', () => {
    process.env[KEY] = 'sk-totally-real-secret-value-12345';
    const env = buildSafeChildEnv();
    expect(env[KEY]).toBeUndefined();
    expect(Object.keys(env)).not.toContain(KEY);
  });

  it('buildSafeChildEnv conserva PATH/SystemRoot (el comando sigue pudiendo resolver binarios)', () => {
    const env = buildSafeChildEnv();
    const hasPath = 'PATH' in env || 'Path' in env;
    expect(hasPath).toBe(true);
  });

  it('un comando que imprime el env (`set`/`env`) no revela la key falsa en el output real de exec', async () => {
    process.env[KEY] = 'sk-totally-real-secret-value-12345';
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'set' : 'env';
    const r = await new LocalBackend().run({ command: cmd, cwd: process.cwd(), timeoutMs: 5000 });
    expect(r.stdout).not.toContain('sk-totally-real-secret-value-12345');
    expect(r.stdout).not.toContain(KEY + '=');
  });

  it('SHINOBI_RUN_ENV_EXTRA_ALLOWLIST permite extender explícitamente (opt-in auditable)', () => {
    process.env.SHINOBI_RUN_ENV_EXTRA_ALLOWLIST = 'MY_CUSTOM_VAR';
    process.env.MY_CUSTOM_VAR = 'not-a-secret-just-config';
    const env = buildSafeChildEnv();
    expect(env.MY_CUSTOM_VAR).toBe('not-a-secret-just-config');
    delete process.env.MY_CUSTOM_VAR;
  });

  it('SAFE_ENV_ALLOWLIST no incluye ningún nombre que matchee patrones de secreto', () => {
    const suspicious = SAFE_ENV_ALLOWLIST.filter(n => /key|token|secret|password|credential/i.test(n));
    expect(suspicious).toEqual([]);
  });
});
