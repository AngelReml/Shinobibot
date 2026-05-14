import { describe, it, expect } from 'vitest';
import { validateDockerImage, buildDockerRunArgs } from '../_docker_backend.js';

describe('validateDockerImage', () => {
  it('acepta imágenes estándar', () => {
    expect(validateDockerImage('alpine:latest')).toBe('alpine:latest');
    expect(validateDockerImage('node:22-alpine')).toBe('node:22-alpine');
    expect(validateDockerImage('ghcr.io/owner/repo:v1.2.3')).toBe('ghcr.io/owner/repo:v1.2.3');
    expect(validateDockerImage('python')).toBe('python');
  });

  it('rechaza imagen vacía', () => {
    expect(() => validateDockerImage('')).toThrow();
  });

  it('rechaza imagen que empieza con guion (flag injection)', () => {
    expect(() => validateDockerImage('-it')).toThrow();
    expect(() => validateDockerImage('--privileged')).toThrow();
  });

  it('rechaza caracteres peligrosos', () => {
    expect(() => validateDockerImage('alpine; rm -rf /')).toThrow();
    expect(() => validateDockerImage('alpine && evil')).toThrow();
    expect(() => validateDockerImage('alpine|whoami')).toThrow();
    expect(() => validateDockerImage("alpine'whoami")).toThrow();
    expect(() => validateDockerImage('alpine`whoami`')).toThrow();
    expect(() => validateDockerImage('alpine$(whoami)')).toThrow();
  });
});

describe('buildDockerRunArgs', () => {
  it('args básicos con defaults', () => {
    const args = buildDockerRunArgs({
      image: 'alpine:latest',
      command: 'echo hi',
      cwd: 'C:\\work',
    });
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('--network=none');
    expect(args).toContain('-v');
    expect(args).toContain('C:\\work:/workspace');
    expect(args).toContain('-w');
    expect(args).toContain('/workspace');
    expect(args).toContain('alpine:latest');
    expect(args).toContain('sh');
    expect(args).toContain('-c');
    expect(args).toContain('echo hi');
  });

  it('network=bridge cuando se pide explícito', () => {
    const args = buildDockerRunArgs({
      image: 'alpine:latest',
      command: 'curl example.com',
      cwd: '/tmp',
      network: 'bridge',
    });
    expect(args).toContain('--network=bridge');
    expect(args).not.toContain('--network=none');
  });

  it('orden: run --rm --network -v cwd:/workspace -w /workspace image sh -c command', () => {
    const args = buildDockerRunArgs({
      image: 'node:22',
      command: 'node -v',
      cwd: '/x',
    });
    // sh -c <command> debe ser los últimos 3 elementos.
    const last3 = args.slice(-3);
    expect(last3).toEqual(['sh', '-c', 'node -v']);
  });

  it('imagen inválida en buildDockerRunArgs lanza', () => {
    expect(() => buildDockerRunArgs({
      image: '-evil',
      command: 'x',
      cwd: '/x',
    })).toThrow();
  });
});
