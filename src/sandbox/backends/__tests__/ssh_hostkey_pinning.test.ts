// F2.5 (auditoría 2026-07) — host key PINNEADA sustituye TOFU
// (StrictHostKeyChecking=accept-new) como defensa primaria contra MITM en
// el backend SSH. Un fingerprint que NO coincide con el pin configurado
// debe ABORTAR la conexión (nunca invocar `ssh` con una clave no
// verificada). Mock del "cliente SSH" (el keyScanner inyectable) — no
// requiere SSH real ni red.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSHBackend, verifyHostFingerprint, type KeyScanner } from '../ssh.js';

const SSH_ENVS = ['SSH_HOST', 'SSH_USER', 'SSH_KEY_PATH', 'SSH_PORT', 'SSH_HOST_FINGERPRINT', 'SSH_ALLOW_FIRST_PROVISION'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SSH_ENVS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of SSH_ENVS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const REAL_FP = 'SHA256:realHostKeyFingerprintABC123';
const WRONG_FP = 'SHA256:attackerMitmFingerprintXYZ789';

function mockScanner(returned: string | undefined, ok = true): KeyScanner {
  return vi.fn(async () => ok ? { ok: true, fingerprint: returned } : { ok: false, error: 'scan failed (mock)' });
}

describe('verifyHostFingerprint — F2.5', () => {
  it('fingerprint real coincide con el pin → allowed=true (pinned_match)', async () => {
    const r = await verifyHostFingerprint('host', '22', REAL_FP, false, mockScanner(REAL_FP));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('pinned_match');
  });

  it('fingerprint real NO coincide con el pin (MITM simulado) → allowed=false (pinned_mismatch)', async () => {
    const r = await verifyHostFingerprint('host', '22', REAL_FP, false, mockScanner(WRONG_FP));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('pinned_mismatch');
    expect(r.detail).toMatch(/no coincide/i);
  });

  it('sin pin y sin opt-in de primer aprovisionamiento → allowed=false (no_pin_no_opt_in)', async () => {
    const r = await verifyHostFingerprint('host', '22', undefined, false, mockScanner(REAL_FP));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_pin_no_opt_in');
  });

  it('sin pin PERO con SSH_ALLOW_FIRST_PROVISION → allowed=true (first_provision_opt_in)', async () => {
    const r = await verifyHostFingerprint('host', '22', undefined, true, mockScanner(REAL_FP));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('first_provision_opt_in');
  });

  it('el escaneo de la host key falla → allowed=false (scan_failed), nunca "allowed por defecto"', async () => {
    const r = await verifyHostFingerprint('host', '22', REAL_FP, false, mockScanner(undefined, false));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('scan_failed');
  });

  it('con pin configurado, el opt-in de primer aprovisionamiento NO se usa (el pin manda)', async () => {
    // Aunque SSH_ALLOW_FIRST_PROVISION esté activo, si hay pin configurado
    // se compara igualmente — un mismatch sigue abortando.
    const r = await verifyHostFingerprint('host', '22', REAL_FP, true, mockScanner(WRONG_FP));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('pinned_mismatch');
  });
});

describe('SSHBackend.run — F2.5 aborta ANTES de invocar ssh si el fingerprint no verifica', () => {
  it('mismatch de fingerprint: run() devuelve success=false sin listar el error como "spawn"', async () => {
    process.env.SSH_HOST = 'vps.example.com';
    process.env.SSH_USER = 'root';
    process.env.SSH_KEY_PATH = '/tmp/fake-key';
    process.env.SSH_HOST_FINGERPRINT = REAL_FP;

    const backend = new SSHBackend({ keyScanner: mockScanner(WRONG_FP) });
    const result = await backend.run({ command: 'echo hi', cwd: '/tmp', timeoutMs: 5000 });

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/ABORTADA/);
    expect(result.stderr).toMatch(/pinned_mismatch/);
  });

  it('sin SSH_HOST_FINGERPRINT ni SSH_ALLOW_FIRST_PROVISION: run() aborta sin intentar conectar', async () => {
    process.env.SSH_HOST = 'vps.example.com';
    process.env.SSH_USER = 'root';
    process.env.SSH_KEY_PATH = '/tmp/fake-key';

    const scanner = mockScanner(REAL_FP);
    const backend = new SSHBackend({ keyScanner: scanner });
    const result = await backend.run({ command: 'echo hi', cwd: '/tmp', timeoutMs: 5000 });

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/ABORTADA/);
    expect(result.stderr).toMatch(/no_pin_no_opt_in/);
    // Ni siquiera se llamó al scanner — el fail-fast es antes de escanear.
    expect(scanner).not.toHaveBeenCalled();
  });

  it('comando destructivo (rm -rf) es rechazado ANTES de verificar el fingerprint', async () => {
    process.env.SSH_HOST = 'vps.example.com';
    process.env.SSH_USER = 'root';
    process.env.SSH_KEY_PATH = '/tmp/fake-key';
    process.env.SSH_HOST_FINGERPRINT = REAL_FP;

    const scanner = mockScanner(REAL_FP);
    const backend = new SSHBackend({ keyScanner: scanner });
    const result = await backend.run({ command: 'rm -rf /', cwd: '/tmp', timeoutMs: 5000 });

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/rechazado/i);
    expect(scanner).not.toHaveBeenCalled();
  });
});
