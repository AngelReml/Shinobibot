// F1.1 — sandbox/backends/local.ts sin ninguna defensa propia (RANK #1 de la
// auditoría 2026-07-01). Estos tests reproducen el ataque exacto contra el
// BACKEND directamente (no contra run_command.ts, que ya tiene su propia
// suite CRIT-01/02/03) — confirman que LocalBackend.run() se defiende a sí
// mismo sin depender de que un caller externo aplique los checks antes.
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '../local.js';
import { runInContext } from '../../../agents/exec_context.js';

function mkBackend() { return new LocalBackend(); }

describe('F1.1 — LocalBackend rechaza comandos destructivos por sí mismo', () => {
  it('rm -rf se bloquea sin llegar a exec()', async () => {
    const r = await mkBackend().run({ command: 'rm -rf /tmp/whatever', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r.success).toBe(false);
    expect(r.exitCode).not.toBe(0);
  });

  it('subshell bypass "rm$(echo -n) -rf X" también se bloquea (misma blacklist que run_command CRIT-01)', async () => {
    const r = await mkBackend().run({ command: 'rm$(echo -n) -rf /tmp/x', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r.success).toBe(false);
  });

  it('taskkill/shutdown se bloquean', async () => {
    const r1 = await mkBackend().run({ command: 'taskkill /F /IM notepad.exe', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r1.success).toBe(false);
    const r2 = await mkBackend().run({ command: 'shutdown /s /t 0', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r2.success).toBe(false);
  });
});
