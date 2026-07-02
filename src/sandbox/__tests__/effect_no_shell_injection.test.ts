// P1.E1-E2 (plan de frontera 2026-07-01) — test de mutación del plan:
// `effect_no_shell_injection.test.ts`.
//
// La promesa del modo argv del monitor: un argumento hostil (`x; rm -rf ~`,
// `$(touch pwn)`, backticks, comillas) llega al programa como BYTES LITERALES,
// nunca al shell como sintaxis. La garantía vive en `composeShellCommand()`:
// quoting POSIX completo (single quotes) y quoting win32 conservador que
// RECHAZA lo que cmd.exe no puede quotear con seguridad (%, !, CR/LF).
//
// Mutación canónica (del plan): degradar la composición a concatenación
// (`[target, ...args].join(' ')`) → el payload `x; touch <canario>` crea el
// canario → este test se pone ROJO. Verificado con el protocolo de la regla #2
// del repo (romper → rojo → restaurar → verde), evidencia en DECISIONES.md.
//
// El test incluye su propio "test del sensor": ejecuta la versión SIN quotear
// y comprueba que el canario SÍ se crea — si el harness no distinguiera ambos
// casos, sería decorativo y esto lo delataría.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  composeShellCommand,
  mediatedEffect,
  _resetMonitorStats,
} from '../monitor.js';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';

const run = (cmd: string, cwd: string) =>
  new Promise<{ code: number }>((resolve) => {
    exec(cmd, { cwd, timeout: 10_000 }, (err) => resolve({ code: (err?.code as number) ?? 0 }));
  });

describe('P1 — composición argv sin inyección de shell (POSIX)', () => {
  it('quotea el separador de comandos: `;` viaja como argumento literal', () => {
    expect(composeShellCommand('echo', ['x; rm -rf ~'], 'linux')).toBe(`echo 'x; rm -rf ~'`);
  });

  it('quotea subshell $( ), backticks, pipes, && y redirecciones', () => {
    expect(composeShellCommand('echo', ['$(touch pwn)'], 'linux')).toBe(`echo '$(touch pwn)'`);
    expect(composeShellCommand('echo', ['`touch pwn`'], 'linux')).toBe(`echo '\`touch pwn\`'`);
    expect(composeShellCommand('echo', ['a | b && c > d'], 'linux')).toBe(`echo 'a | b && c > d'`);
  });

  it('sobrevive comillas simples embebidas (álgebra \'\\\'\' de POSIX)', () => {
    expect(composeShellCommand('echo', ["it's"], 'linux')).toBe(`echo 'it'\\''s'`);
  });

  it('argumento vacío se preserva como \'\' (no desaparece)', () => {
    expect(composeShellCommand('printf', ['%s', ''], 'linux')).toBe(`printf %s ''`);
  });

  it('tokens seguros no se quotean (comandos legibles en el audit)', () => {
    expect(composeShellCommand('git', ['status', '--porcelain'], 'linux')).toBe('git status --porcelain');
  });

  it('target vacío se rechaza', () => {
    expect(() => composeShellCommand('', ['x'], 'linux')).toThrow(/target vacío/);
  });
});

describe('P1 — composición argv win32: fail-closed ante lo no-quoteable', () => {
  it('espacios y comillas se quotean al estilo del runtime C de Windows', () => {
    expect(composeShellCommand('echo', ['hello world'], 'win32')).toBe('echo "hello world"');
    expect(composeShellCommand('echo', ['say "hi"'], 'win32')).toBe('echo "say \\"hi\\""');
  });

  it('RECHAZA argumentos con % (expansión %VAR% de cmd.exe no es quoteable)', () => {
    expect(() => composeShellCommand('echo', ['%PATH%'], 'win32')).toThrow(/no quoteable/);
  });

  it('RECHAZA argumentos con ! y con CR/LF', () => {
    expect(() => composeShellCommand('echo', ['hola!mundo'], 'win32')).toThrow(/no quoteable/);
    expect(() => composeShellCommand('echo', ['a\r\nb'], 'win32')).toThrow(/no quoteable/);
  });
});

describe.runIf(process.platform !== 'win32')('P1 — E2E real: el payload no ejecuta (shell POSIX de verdad)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi_inj_'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('compuesto por el monitor: `x; touch canario` NO crea el canario', async () => {
    const canary = path.join(dir, 'canario_compuesto');
    const composed = composeShellCommand('echo', [`x; touch ${canary}`]);
    await run(composed, dir);
    expect(fs.existsSync(canary), `INYECCIÓN: el shell ejecutó el payload — ${composed}`).toBe(false);
  });

  it('test del sensor: la concatenación naïve SÍ crea el canario (el harness distingue)', async () => {
    const canary = path.join(dir, 'canario_naive');
    // Esto es lo que la mutación canónica produciría: join(' ') sin quoting.
    const naive = ['echo', `x; touch ${canary}`].join(' ');
    await run(naive, dir);
    expect(fs.existsSync(canary), 'el harness no detecta ni la inyección obvia: test decorativo').toBe(true);
  });
});

describe('P1 — el modo argv atraviesa el monitor ya compuesto (MockBackend)', () => {
  beforeEach(() => {
    _resetSandboxRegistry();
    _resetMonitorStats();
  });

  it('el backend recibe EXACTAMENTE la línea compuesta, no una interpolación', async () => {
    const seen: string[] = [];
    sandboxRegistry().register(
      new MockBackend({
        id: 'mock',
        scriptedOutput: (cmd) => {
          seen.push(cmd);
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        },
      }),
    );
    const res = await mediatedEffect({
      kind: 'shell',
      target: 'echo',
      args: ['x; touch pwn'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      backendId: 'mock',
      reversible: false,
    });
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(composeShellCommand('echo', ['x; touch pwn']));
    // Y la forma compuesta jamás es la concatenación cruda:
    expect(seen[0]).not.toBe('echo x; touch pwn');
  });

  it('argv no componible (win32-only chars en win32) deniega en vez de ejecutar', async () => {
    // Solo asertable de forma determinista vía la función pura (la rama de
    // plataforma del monitor usa process.platform); el contrato queda fijado
    // arriba. Aquí: el monitor deniega si composeShellCommand lanza.
    if (process.platform === 'win32') {
      const res = await mediatedEffect({
        kind: 'shell',
        target: 'echo',
        args: ['%PATH%'],
        cwd: process.cwd(),
        timeoutMs: 5_000,
        backendId: 'mock',
        reversible: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('invalid_effect');
    } else {
      expect(composeShellCommand('echo', ['%PATH%'], 'linux')).toBe('echo %PATH%'); // en POSIX % es inerte
    }
  });
});
