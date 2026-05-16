import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { checkDestructive, checkSandbox } from '../run_command.js';

describe('checkDestructive', () => {
  it('bloquea comandos destructivos en cualquier variante de sintaxis', () => {
    expect(checkDestructive('rm -rf /')).not.toBeNull();
    expect(checkDestructive('rm -fr node_modules')).not.toBeNull();
    expect(checkDestructive('Remove-Item -Recurse C:\\temp')).not.toBeNull();
    expect(checkDestructive('Remove-Item -Force foo.txt')).not.toBeNull();
    expect(checkDestructive('taskkill /F /IM node.exe')).not.toBeNull();
    expect(checkDestructive('Stop-Process -Name node')).not.toBeNull();
    expect(checkDestructive('diskpart')).not.toBeNull();
    expect(checkDestructive('del /f /q file.txt')).not.toBeNull();
    expect(checkDestructive('rmdir /s folder')).not.toBeNull();
    expect(checkDestructive('rd /s folder')).not.toBeNull();
    expect(checkDestructive('cipher /w:C')).not.toBeNull();
    expect(checkDestructive('format C:')).not.toBeNull();
  });

  it('no bloquea comandos legítimos que contienen substrings ambiguos', () => {
    expect(checkDestructive('git format-patch -1')).toBeNull();
    expect(checkDestructive('npm run format')).toBeNull();
    expect(checkDestructive('git status')).toBeNull();
    expect(checkDestructive('node build.js')).toBeNull();
    expect(checkDestructive('Remove-Item single.txt')).toBeNull();
  });
});

describe('checkSandbox', () => {
  let savedWorkspace: string | undefined;
  beforeAll(() => {
    savedWorkspace = process.env.WORKSPACE_ROOT;
    delete process.env.WORKSPACE_ROOT;
  });
  afterAll(() => {
    if (savedWorkspace !== undefined) process.env.WORKSPACE_ROOT = savedWorkspace;
  });

  const outside = resolve(tmpdir(), 'shinobi-test-outside-xyz');

  it('permite rutas dentro del cwd de Shinobi', () => {
    expect(checkSandbox('git status', process.cwd())).toBeNull();
  });

  it('permite `node build` fuera del workspace (readonly leader)', () => {
    expect(checkSandbox('node build.js', outside)).toBeNull();
  });

  it('bloquea `node -e` fuera del workspace (ejecuta código arbitrario)', () => {
    expect(checkSandbox('node -e "process.exit(0)"', outside)).not.toBeNull();
    expect(checkSandbox('npx --eval "x"', outside)).not.toBeNull();
  });

  it('bloquea comandos no readonly fuera del workspace', () => {
    expect(checkSandbox('python evil.py', outside)).not.toBeNull();
  });
});
