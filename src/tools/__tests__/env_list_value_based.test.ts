import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../env_list.js';
import { getTool } from '../tool_registry.js';

/**
 * F2.7 — env_list.ts debe redactar por VALOR además de por nombre.
 * Construimos los secretos de prueba en runtime (nunca literales en el
 * fuente) para no disparar secret-scanning en el propio repo.
 */
function fakeConnString(): string {
  return 'postgres://user:' + 'p'.repeat(12) + 'X9@db.internal.example.com:5432/prod';
}
function fakeAwsSecret(): string {
  return 'A'.repeat(40);
}

describe('env_list — F2.7 redacción por valor', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keys = ['WEIRD_NAME_NOT_SENSITIVE', 'HOST_CONFIG', 'PLAIN_HARMLESS_VAR', 'aws_secret_access_key'];

  beforeEach(() => {
    for (const k of keys) savedEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('variable con nombre atípico pero valor de connection string se redacta por contenido', async () => {
    process.env.WEIRD_NAME_NOT_SENSITIVE = fakeConnString();
    const tool = getTool('env_list')!;
    const r = await tool.execute({ nameFilter: 'weird_name_not_sensitive' });
    expect(r.success).toBe(true);
    const out = JSON.parse(r.output) as Array<{ name: string; value: string }>;
    const entry = out.find(e => e.name === 'WEIRD_NAME_NOT_SENSITIVE');
    expect(entry).toBeDefined();
    expect(entry!.value).not.toContain(fakeConnString());
    expect(entry!.value).toContain('<REDACTED:');
  });

  it('aws_secret_access_key (nombre no matchea SENSITIVE_NAME_PATTERNS por mayúsculas/formato) se redacta por contenido', async () => {
    process.env.aws_secret_access_key = fakeAwsSecret();
    const tool = getTool('env_list')!;
    const r = await tool.execute({ nameFilter: 'aws_secret_access_key' });
    const out = JSON.parse(r.output) as Array<{ name: string; value: string }>;
    const entry = out.find(e => e.name === 'aws_secret_access_key');
    expect(entry).toBeDefined();
    expect(entry!.value).not.toContain(fakeAwsSecret());
  });

  it('variable verdaderamente inocua no se toca (sin falsos positivos masivos)', async () => {
    process.env.PLAIN_HARMLESS_VAR = 'just-a-normal-short-value';
    const tool = getTool('env_list')!;
    const r = await tool.execute({ nameFilter: 'plain_harmless_var' });
    const out = JSON.parse(r.output) as Array<{ name: string; value: string }>;
    const entry = out.find(e => e.name === 'PLAIN_HARMLESS_VAR');
    expect(entry!.value).toBe('just-a-normal-short-value');
  });

  it('nombre sensible (heurística previa) sigue totalmente redactado, sin cambios de comportamiento', async () => {
    process.env.HOST_CONFIG = 'not-actually-secret-value';
    // HOST_CONFIG no matchea el nombre sensible; usamos una var que sí matchea
    // para confirmar que la ruta de nombre-sensible sigue intacta.
    process.env.SOME_API_KEY = 'irrelevant-value-here';
    const tool = getTool('env_list')!;
    const r = await tool.execute({ nameFilter: 'some_api_key' });
    const out = JSON.parse(r.output) as Array<{ name: string; value: string }>;
    const entry = out.find(e => e.name === 'SOME_API_KEY');
    expect(entry!.value).toBe('<REDACTED>');
    delete process.env.SOME_API_KEY;
  });
});
