// src/tools/__tests__/spawn_agent.test.ts
//
// Tests del wrapper de delegación spawn_agent (sobre agent_loop). Deterministas:
// el LLM del subagente se inyecta vía __setSpawnInvokerForTest (sin red) y el
// audit se desactiva. Cubre: formato de resultado, filtrado de tools
// destructivas (seguridad), profundidad de spawn, restauración de env y
// validación de entrada.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import spawnAgent, { __setSpawnInvokerForTest, __setWorktreeManagerForTest } from '../spawn_agent.js';
import '../write_file.js'; // registra la tool real write_file en el registry
import '../run_command.js'; // registra la tool real run_command en el registry
import { WorktreeManager } from '../../agents/worktree.js';
import { sandboxRegistry, _resetSandboxRegistry } from '../../sandbox/registry.js';
import type { RunBackend, RunOutput } from '../../sandbox/types.js';
import type { LLMInvoker } from '../../agents/agent_loop.js';

/** Invocador que cierra de inmediato con un texto fijo. */
const completesWith = (text: string): LLMInvoker => async () => ({
  success: true,
  output: JSON.stringify({ content: text }),
  error: '',
});

beforeAll(() => {
  process.env.SHINOBI_AUDIT_DISABLED = '1';
});
afterAll(() => {
  delete process.env.SHINOBI_AUDIT_DISABLED;
  __setSpawnInvokerForTest(null);
});
afterEach(() => {
  delete process.env.SHINOBI_SPAWN_DEPTH;
  __setSpawnInvokerForTest(null);
});

describe('spawn_agent — delegación multi-agente', () => {
  it('devuelve el resultado del subagente cuando cierra limpio', async () => {
    __setSpawnInvokerForTest(completesWith('tarea resuelta'));
    const res = await spawnAgent.execute({ task: 'haz algo', tools: ['read_file'] });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/COMPLETED/);
    expect(res.output).toContain('tarea resuelta');
  });

  it('falla limpio si falta la task', async () => {
    const res = await spawnAgent.execute({ task: '   ' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/task/);
  });

  it('filtra herramientas destructivas de la caja del subagente (seguridad)', async () => {
    __setSpawnInvokerForTest(completesWith('ok'));
    const res = await spawnAgent.execute({
      task: 'algo',
      tools: ['read_file', 'run_command', 'write_file'],
    });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/destructivas excluidas/);
    expect(res.output).toContain('run_command');
    expect(res.output).toContain('write_file');
  });

  it('aborta por profundidad de spawn alcanzada', async () => {
    process.env.SHINOBI_SPAWN_DEPTH = '3'; // hijo sería nivel 4 ≥ maxDepth(3)
    __setSpawnInvokerForTest(completesWith('no debería llegar'));
    const res = await spawnAgent.execute({ task: 'algo' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/profundidad|DEPTH/i);
  });

  it('restaura SHINOBI_SPAWN_DEPTH tras ejecutar', async () => {
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
    __setSpawnInvokerForTest(completesWith('ok'));
    await spawnAgent.execute({ task: 'algo', tools: ['read_file'] });
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
  });

  it('isolation=worktree sin repo git falla limpio', async () => {
    // Mánager apuntando a un dir temporal que NO es repo git.
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-norepo-'));
    __setWorktreeManagerForTest(new WorktreeManager({ repoRoot: notRepo, baseDir: path.join(notRepo, '.wt') }));
    __setSpawnInvokerForTest(completesWith('ok'));
    const res = await spawnAgent.execute({ task: 'algo', isolation: 'worktree' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/repositorio git/i);
    __setWorktreeManagerForTest(null);
    fs.rmSync(notRepo, { recursive: true, force: true, maxRetries: 3 });
  });
});

// ── Integración: isolation por worktree con git real ──────────────────────

describe('spawn_agent — isolation worktree (git real)', () => {
  let repo: string;
  const originalCwd = process.cwd();

  const toolCallMsg = (name: string, args: unknown) =>
    JSON.stringify({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const textMsg = (t: string) => JSON.stringify({ content: t });
  const script = (steps: string[]): LLMInvoker => {
    let i = 0;
    return async () => ({ success: true, output: steps[Math.min(i++, steps.length - 1)], error: '' });
  };

  beforeAll(() => {
    process.env.SHINOBI_AUDIT_DISABLED = '1';
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-spawn-wt-'));
    const run = (args: string[]) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
      if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} → ${r.stderr}`);
    };
    run(['init', '-q']);
    run(['config', 'user.email', 'test@shinobi.local']);
    run(['config', 'user.name', 'Shinobi Test']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    __setWorktreeManagerForTest(new WorktreeManager({ repoRoot: repo, baseDir: path.join(repo, '.wt') }));
  });

  afterAll(() => {
    delete process.env.SHINOBI_AUDIT_DISABLED;
    __setWorktreeManagerForTest(null);
    __setSpawnInvokerForTest(null);
    try { process.chdir(originalCwd); } catch { /* ignore */ }
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
  });

  it('permite write_file (confinada al worktree), filtra run_command y conserva el worktree con cambios', async () => {
    __setSpawnInvokerForTest(script([
      toolCallMsg('write_file', { path: 'out.txt', content: 'hola desde el subagente' }),
      textMsg('archivo creado'),
    ]));

    const res = await spawnAgent.execute({
      task: 'crea out.txt',
      tools: ['write_file', 'run_command'], // run_command debe filtrarse
      isolation: 'worktree',
      label: 'writer',
    });

    expect(res.success).toBe(true);
    // write_file NO se filtró (no aparece en la nota de exclusión)
    expect(res.output).not.toMatch(/excluidas[^\n]*write_file/);
    // run_command sí se filtró
    expect(res.output).toMatch(/excluidas[^\n]*run_command/);
    // worktree conservado por tener cambios
    expect(res.output).toMatch(/worktree conservado con cambios/);
    // cwd restaurado tras la ejecución
    expect(process.cwd()).toBe(originalCwd);

    // el fichero existe dentro del worktree conservado
    const wt = new WorktreeManager({ repoRoot: repo, baseDir: path.join(repo, '.wt') })
      .list()
      .find((w) => /shinobi-wt-writer/.test(w.branch));
    expect(wt, 'debe existir el worktree del writer').toBeTruthy();
    expect(fs.existsSync(path.join(wt!.path, 'out.txt'))).toBe(true);
  });
});

// ── Sandbox de ejecución ──────────────────────────────────────────────────

describe('spawn_agent — sandbox de ejecución', () => {
  const toolCallMsg = (name: string, args: unknown) =>
    JSON.stringify({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const textMsg = (t: string) => JSON.stringify({ content: t });
  const script = (steps: string[]): LLMInvoker => {
    let i = 0;
    return async () => ({ success: true, output: steps[Math.min(i++, steps.length - 1)], error: '' });
  };

  // Detección del daemon Docker en tiempo de colección (no en beforeAll, que
  // corre después de evaluar it.skipIf). Gated: el test real solo corre donde
  // el daemon está arriba.
  const DOCKER_UP = (() => {
    try { return (spawnSync('docker', ['info'], { timeout: 8000, encoding: 'utf-8' }).status ?? 1) === 0; }
    catch { return false; }
  })();

  beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
  afterAll(() => {
    delete process.env.SHINOBI_AUDIT_DISABLED;
    __setSpawnInvokerForTest(null);
    _resetSandboxRegistry();
  });
  afterEach(() => {
    delete process.env.SHINOBI_RUN_BACKEND;
    _resetSandboxRegistry();
  });

  it('sandbox=docker con daemon caído falla loud (no ejecuta en el host)', async () => {
    __setSpawnInvokerForTest(completesWith('no debería ejecutarse'));
    const res = await spawnAgent.execute({ task: 'corre algo', tools: ['run_command'], sandbox: 'docker' });
    // En este entorno el daemon docker está caído → debe fallar, no caer al host.
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/docker/i);
    expect(res.error).toMatch(/host|seguridad/i);
  });

  it('sandbox=e2b sin configurar falla loud', async () => {
    delete process.env.E2B_API_KEY;
    __setSpawnInvokerForTest(completesWith('x'));
    const res = await spawnAgent.execute({ task: 'corre algo', tools: ['run_command'], sandbox: 'e2b' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/e2b/i);
  });

  it('con sandbox activo, run_command se DESBLOQUEA y se routea al backend; env restaurada', async () => {
    // Backend falso registrado bajo id 'e2b' (isConfigured=true) → valida el
    // wiring sin e2b/docker reales.
    let backendCalls = 0;
    const fake: RunBackend = {
      id: 'e2b',
      label: 'fake',
      requiredEnvVars: () => [],
      isConfigured: () => true,
      async run(): Promise<RunOutput> {
        backendCalls++;
        return { success: true, stdout: 'SANDBOXED_OK', stderr: '', exitCode: 0, backend: 'e2b', durationMs: 1 };
      },
    };
    sandboxRegistry().register(fake);

    __setSpawnInvokerForTest(script([
      toolCallMsg('run_command', { command: 'echo hola' }),
      textMsg('comando ejecutado'),
    ]));

    const res = await spawnAgent.execute({
      task: 'ejecuta echo',
      tools: ['run_command'],
      sandbox: 'e2b',
      label: 'runner',
    });

    expect(res.success).toBe(true);
    expect(res.output).toMatch(/sandbox de ejecución: e2b/);
    // run_command NO se filtró
    expect(res.output).not.toMatch(/excluidas[^\n]*run_command/);
    // se routeó al backend de sandbox (no al host)
    expect(backendCalls).toBe(1);
    // env de backend restaurada tras ejecutar
    expect(process.env.SHINOBI_RUN_BACKEND).toBeUndefined();
  });

  // Integración REAL con Docker — gated: solo corre si el daemon está arriba.
  // En entornos sin daemon (incl. este) se salta; en CI/maquina con Docker
  // valida la ejecución de run_command DENTRO de un contenedor efímero.
  it.skipIf(!DOCKER_UP)('REAL docker: run_command corre dentro de un contenedor efímero', async () => {
    __setSpawnInvokerForTest(script([
      toolCallMsg('run_command', { command: 'echo sandboxed-ok' }),
      textMsg('hecho'),
    ]));
    const res = await spawnAgent.execute({
      task: 'ejecuta echo en el sandbox',
      tools: ['run_command'],
      sandbox: 'docker',
      label: 'docker-runner',
    });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/sandbox de ejecución: docker/);
    expect(process.env.SHINOBI_RUN_BACKEND).toBeUndefined();
  }, 120_000);
});
