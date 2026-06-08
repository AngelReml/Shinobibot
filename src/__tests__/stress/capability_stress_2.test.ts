// Capability stress — parte 2: superficie de seguridad + dispatch.
//   - validatePath: traversal, paths sensibles, fuzz (nunca lanza).
//   - isDangerousCommand: catch de patrones documentados SIN falsos positivos.
//   - approval no-op (FIX-002): requestApproval→true, isDestructive→false SIEMPRE.
//   - IntentRouter.route: fuzz async (nunca lanza, shape válido).

import { describe, it, expect, afterEach } from 'vitest';
import { validatePath, isDangerousCommand } from '../../utils/permissions.js';
import { requestApproval, isDestructive, setApprovalAsker, clearSessionApprovals } from '../../security/approval.js';
import { IntentRouter } from '../../dispatch/intent_router.js';

describe('STRESS · validatePath (seguridad de rutas)', () => {
  const traversal = [
    '../../../etc/passwd', '..\\..\\..\\Windows\\System32\\cmd.exe',
    '/etc/shadow', 'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'C:\\Windows\\System32', '\\\\server\\share\\x',
    '....//....//etc/passwd', 'foo/../../bar',
  ];

  it('NUNCA lanza, sea cual sea el input', () => {
    const inputs = [...traversal, '', '   ', '\0', 'a'.repeat(10000), '🔥', 'C:'];
    for (const p of inputs) {
      for (const mode of ['read', 'write'] as const) {
        let r: any;
        expect(() => { r = validatePath(p, mode); }).not.toThrow();
        expect(typeof r.allowed).toBe('boolean');
      }
    }
  });

  it('paths de sistema sensibles → denegados (System32 / /etc/shadow)', () => {
    const sensitive = ['C:\\Windows\\System32', 'C:\\Windows\\System32\\config\\SAM', '/etc/shadow', '/etc/passwd'];
    for (const p of sensitive) {
      const r = validatePath(p, 'write');
      expect(r.allowed).toBe(false);
      expect(typeof r.reason).toBe('string');
    }
  });

  it('escritura fuera del workspace → denegada', () => {
    const outside = process.platform === 'win32'
      ? 'C:\\Users\\otro\\secreto.txt'
      : '/tmp/outside-shinobi-secreto.txt';
    const r = validatePath(outside, 'write');
    expect(r.allowed).toBe(false);
  });
});

describe('STRESS · isDangerousCommand', () => {
  it('NUNCA lanza; siempre boolean', () => {
    for (const c of ['', '   ', '\0', 'a'.repeat(50000), '🔥', 'rm -rf /']) {
      let out: any;
      expect(() => { out = isDangerousCommand(c); }).not.toThrow();
      expect(typeof out).toBe('boolean');
    }
  });

  it('detecta sus patrones documentados', () => {
    const dangerous = [
      'rm -rf /', 'sudo rm -rf /home', 'del /s C:\\temp',
      'mkfs.ext4 /dev/sda1', 'format C:', 'dd if=/dev/zero of=/dev/sda',
      'shutdown now', 'reboot',
    ];
    for (const c of dangerous) expect(isDangerousCommand(c)).toBe(true);
  });

  it('SIN falsos positivos en comandos benignos (npm run format, etc.)', () => {
    const benign = [
      'npm run format', 'ls -la', 'git status', 'echo hello',
      'npm install', 'node script.js', 'git reset --soft HEAD~1',
      'cat archivo.txt', 'cd /home/user',
    ];
    for (const c of benign) expect(isDangerousCommand(c)).toBe(false);
  });
});

describe('STRESS · gate selectivo (PASO 3)', () => {
  const prevMode = process.env.SHINOBI_APPROVAL_MODE;
  afterEach(() => {
    if (prevMode === undefined) delete process.env.SHINOBI_APPROVAL_MODE;
    else process.env.SHINOBI_APPROVAL_MODE = prevMode;
    setApprovalAsker(null);
    clearSessionApprovals();
  });

  it('mode=off → no-op (isDestructive false, requestApproval true) SIEMPRE', async () => {
    process.env.SHINOBI_APPROVAL_MODE = 'off';
    expect(isDestructive('write_file', { path: 'C:\\Windows\\System32\\evil.dll', content: 'x' }).destructive).toBe(false);
    expect(isDestructive('start_cloud_mission', {}).destructive).toBe(false);
    await expect(requestApproval({ toolName: 'write_file', args: {}, destructive: true })).resolves.toBe(true);
  });

  it('mode=critical → flaggea la clase crítica, NO la destrucción genérica', () => {
    process.env.SHINOBI_APPROVAL_MODE = 'critical';
    // Crítico: zona de credenciales, secreto en fichero, login, gasto, externo.
    expect(isDestructive('write_file', { path: 'C:\\proj\\.env', content: 'X=1' }).destructive).toBe(true);
    expect(isDestructive('write_file', { path: 'notes.txt', content: 'la clave es AKIAIOSFODNN7EXAMPLE' }).destructive).toBe(true);
    expect(isDestructive('run_command', { command: 'aws configure' }).destructive).toBe(true);
    expect(isDestructive('start_cloud_mission', {}).destructive).toBe(true);
    expect(isDestructive('mcp_connect', { name: 'x', command: 'y' }).destructive).toBe(true);
    // NO crítico: destrucción genérica y rutina (otra preocupación, no este freno).
    expect(isDestructive('run_command', { command: 'rm -rf /' }).destructive).toBe(false);
    expect(isDestructive('write_file', { path: 'src/foo.ts', content: 'const a=1' }).destructive).toBe(false);
    expect(isDestructive('read_file', { path: '.env' }).destructive).toBe(false);
  });

  it('mode=critical → requestApproval: crítico sin asker DENIEGA; no-crítico procede', async () => {
    process.env.SHINOBI_APPROVAL_MODE = 'critical';
    setApprovalAsker(null);
    await expect(requestApproval({ toolName: 'start_cloud_mission', args: {}, destructive: true })).resolves.toBe(false);
    await expect(requestApproval({ toolName: 'write_file', args: {}, destructive: false })).resolves.toBe(true);
  });

  it('mode=critical → asker "no" deniega, "yes" aprueba', async () => {
    process.env.SHINOBI_APPROVAL_MODE = 'critical';
    setApprovalAsker(async () => 'no');
    await expect(requestApproval({ toolName: 'mcp_connect', args: {}, destructive: true })).resolves.toBe(false);
    setApprovalAsker(async () => 'yes');
    await expect(requestApproval({ toolName: 'mcp_connect', args: {}, destructive: true })).resolves.toBe(true);
  });
});

describe('STRESS · IntentRouter.route (fuzz async)', () => {
  it('NUNCA lanza y devuelve shape válido para inputs arbitrarios (no-comando)', async () => {
    const inputs = [
      '', '   ', 'hola que tal', 'a'.repeat(20000), '🔥💥', '日本語',
      '<script>alert(1)</script>', '{"k":"v"}', 'busca noticias de hoy',
      '\0\0\0', 'SELECT * FROM users; DROP TABLE x;',
    ];
    for (const i of inputs) {
      let r: any;
      await expect((async () => { r = await IntentRouter.route(i); })()).resolves.toBeUndefined();
      expect(typeof r.matched).toBe('boolean');
      expect(['command', 'regex_intent', 'agent_activation', 'none']).toContain(r.type);
    }
  });
});
