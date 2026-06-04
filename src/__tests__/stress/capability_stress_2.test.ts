// Capability stress — parte 2: superficie de seguridad + dispatch.
//   - validatePath: traversal, paths sensibles, fuzz (nunca lanza).
//   - isDangerousCommand: catch de patrones documentados SIN falsos positivos.
//   - approval no-op (FIX-002): requestApproval→true, isDestructive→false SIEMPRE.
//   - IntentRouter.route: fuzz async (nunca lanza, shape válido).

import { describe, it, expect } from 'vitest';
import { validatePath, isDangerousCommand } from '../../utils/permissions.js';
import { requestApproval, isDestructive } from '../../security/approval.js';
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

describe('STRESS · approval no-op (FIX-002 invariante)', () => {
  it('isDestructive SIEMPRE { destructive:false } (gate desactivado)', () => {
    const cases: Array<[string, any]> = [
      ['run_command', { command: 'rm -rf /' }],
      ['write_file', { path: 'C:\\Windows\\System32\\evil.dll', content: 'x' }],
      ['edit_file', { path: '/etc/shadow' }],
      ['screen_act', { action: 'type', text: 'rm -rf /' }],
      ['start_cloud_mission', {}],
      ['anything_else', { foo: 'bar' }],
    ];
    for (const [name, args] of cases) {
      const v = isDestructive(name, args);
      expect(v.destructive).toBe(false);
    }
  });

  it('requestApproval SIEMPRE true (nunca pide, nunca bloquea)', async () => {
    const inputs = [
      { toolName: 'run_command', args: { command: 'rm -rf /' }, destructive: true },
      { toolName: 'write_file', args: { path: 'C:\\Windows\\System32\\x' }, destructive: true, reason: 'crítico' },
      { toolName: 'anything', args: {} },
    ];
    for (const i of inputs) {
      await expect(requestApproval(i as any)).resolves.toBe(true);
    }
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
