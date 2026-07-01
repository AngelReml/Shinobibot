// F2.2 (auditoría 2026-07): verifica que `buildDockerRunArgs` construye un
// array de args de `docker run` con límites de memoria/CPU/PIDs y hardening
// de privilegios. Test de CONSTRUCCIÓN de args — no requiere Docker real.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDockerRunArgs } from '../../../tools/_docker_backend.js';

const ENV_KEYS = ['SHINOBI_DOCKER_MEMORY', 'SHINOBI_DOCKER_CPUS', 'SHINOBI_DOCKER_PIDS_LIMIT'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('buildDockerRunArgs — F2.2 límites de recursos + hardening', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  function build() {
    return buildDockerRunArgs({ image: 'alpine:latest', command: 'echo hi', cwd: '/tmp/ws' });
  }

  it('incluye --memory con default conservador (512m)', () => {
    const args = build();
    const i = args.indexOf('--memory');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('512m');
  });

  it('fija --memory-swap IGUAL a --memory (sin swap extra)', () => {
    const args = build();
    const memIdx = args.indexOf('--memory');
    const swapIdx = args.indexOf('--memory-swap');
    expect(swapIdx).toBeGreaterThan(-1);
    expect(args[swapIdx + 1]).toBe(args[memIdx + 1]);
  });

  it('incluye --cpus con default conservador (1)', () => {
    const args = build();
    const i = args.indexOf('--cpus');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('1');
  });

  it('incluye --pids-limit con default conservador (100)', () => {
    const args = build();
    const i = args.indexOf('--pids-limit');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('100');
  });

  it('incluye --cap-drop ALL', () => {
    const args = build();
    const i = args.indexOf('--cap-drop');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('ALL');
  });

  it('cap-drop=ALL va acompañado de al menos un --cap-add mínimo necesario', () => {
    const args = build();
    const capAddCount = args.filter((a) => a === '--cap-add').length;
    expect(capAddCount).toBeGreaterThan(0);
  });

  it('incluye --security-opt no-new-privileges', () => {
    const args = build();
    const i = args.indexOf('--security-opt');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('no-new-privileges');
  });

  it('incluye --read-only con --tmpfs /tmp para lo escribible', () => {
    const args = build();
    expect(args).toContain('--read-only');
    const tmpfsIdx = args.indexOf('--tmpfs');
    expect(tmpfsIdx).toBeGreaterThan(-1);
    expect(args[tmpfsIdx + 1]).toBe('/tmp');
  });

  it('preserva --network=none por defecto (comportamiento previo)', () => {
    const args = build();
    expect(args).toContain('--network=none');
  });

  it('sigue montando cwd en /workspace (comportamiento previo)', () => {
    const args = build();
    const vIdx = args.indexOf('-v');
    expect(vIdx).toBeGreaterThan(-1);
    expect(args[vIdx + 1]).toBe('/tmp/ws:/workspace');
  });

  it('los límites son configurables por env var', () => {
    process.env.SHINOBI_DOCKER_MEMORY = '256m';
    process.env.SHINOBI_DOCKER_CPUS = '0.5';
    process.env.SHINOBI_DOCKER_PIDS_LIMIT = '50';
    const args = build();
    expect(args[args.indexOf('--memory') + 1]).toBe('256m');
    expect(args[args.indexOf('--memory-swap') + 1]).toBe('256m');
    expect(args[args.indexOf('--cpus') + 1]).toBe('0.5');
    expect(args[args.indexOf('--pids-limit') + 1]).toBe('50');
  });

  it('todo docker run del backend lleva TODOS los flags de límite a la vez', () => {
    const args = build();
    for (const flag of ['--memory', '--memory-swap', '--cpus', '--pids-limit', '--cap-drop', '--security-opt', '--read-only', '--tmpfs']) {
      expect(args).toContain(flag);
    }
  });
});
