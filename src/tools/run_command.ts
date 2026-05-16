/**
 * RunCommand Tool — Execute a shell command with safety checks
 */
import { exec } from 'child_process';
import { resolve as resolvePath, sep } from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { isDangerousCommand } from '../utils/permissions.js';

// Patrones destructivos NO configurables por el LLM. Si el command crudo
// matchea cualquiera de estos (case-insensitive), se rechaza antes de
// ejecutar. Se usan regex ancladas en vez de substring `includes()` para
// no dar falsos positivos (ej. `git format-patch` no debe matchear
// `format`) ni dejar evasiones triviales por variantes de sintaxis.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bstop-process\b/i,
  /\b(taskkill|pkill|killall)\b/i,
  /\bkill\s+-9\b/i,
  /\bwmic\s+process\b/i,
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf / -fr en cualquier orden
  /\brmdir\s+\/s\b/i,
  /\brd\s+\/s\b/i,
  /\bdel\s+\/[a-z]*[sf]/i,                          // del /f, del /s, del /q...
  /\bremove-item\b[^\n|;&]*\s-(recurse|r)\b/i,      // Remove-Item recursivo
  /\bremove-item\b[^\n|;&]*\s-force\b/i,            // Remove-Item -Force
  /\bclear-content\b/i,
  /\bformat\s+[a-z]:/i,                             // format C:
  /\bformat\b[^\n|;&]*\s\/(fs|q|x)\b/i,             // format /fs:.. /q /x
  /\bcipher\s+\/w\b/i,                              // cipher /w (wipe)
  /\bdiskpart\b/i,
];

// Comandos puramente de lectura/build que pueden operar fuera del workspace
// raíz (ej. tsc compilando un proyecto adyacente, git status en otro repo).
const READONLY_LEADERS = new Set(['git', 'node', 'npx', 'tsc']);

// `node`/`npx` con eval inline NO son de solo lectura: ejecutan código
// arbitrario y no deben gozar de la excepción de sandbox de READONLY_LEADERS.
const NODE_EVAL_FLAGS = /(^|\s)(-e|--eval|-p|--print)(\s|=|$)/i;

function normalizeDir(p: string): string {
  // resolvePath devuelve absoluto. Quitamos separador final para comparar
  // prefijos sin falsos positivos (C:\work vs C:\work2).
  const abs = resolvePath(p);
  return abs.endsWith(sep) ? abs.slice(0, -1) : abs;
}

function isInside(child: string, parent: string): boolean {
  const c = normalizeDir(child).toLowerCase();
  const p = normalizeDir(parent).toLowerCase();
  return c === p || c.startsWith(p + sep.toLowerCase());
}

function firstToken(command: string): string {
  const trimmed = command.trim().replace(/^["']/, '');
  const m = trimmed.match(/^[^\s"']+/);
  return (m ? m[0] : '').toLowerCase();
}

/** Devuelve mensaje de error si el comando viola la blacklist, o null si pasa. */
export function checkDestructive(command: string): string | null {
  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (pat.test(command)) {
      return 'Comando rechazado: esta acción podría dañar el sistema. Pide al usuario que lo haga manualmente si es necesario.';
    }
  }
  return null;
}

/** Devuelve mensaje de error si el cwd cae fuera del sandbox, o null si pasa. */
export function checkSandbox(command: string, cwd: string): string | null {
  const workspaceRoot = process.env.WORKSPACE_ROOT
    ? normalizeDir(process.env.WORKSPACE_ROOT)
    : null;
  const shinobiRoot = normalizeDir(process.cwd());
  const target = normalizeDir(cwd);

  if (workspaceRoot && isInside(target, workspaceRoot)) return null;
  if (isInside(target, shinobiRoot)) return null;

  // Excepción: comandos de solo lectura/build pueden operar en rutas de
  // proyecto aunque queden fuera del workspace raíz. `node`/`npx` con eval
  // inline (-e/--eval/-p/--print) NO cuentan: ejecutan código arbitrario.
  const leader = firstToken(command);
  if (READONLY_LEADERS.has(leader)) {
    if ((leader === 'node' || leader === 'npx') && NODE_EVAL_FLAGS.test(command)) {
      return 'Comando rechazado: `node`/`npx` con eval inline (-e/-p) no puede ejecutarse fuera del workspace de Shinobi.';
    }
    return null;
  }

  return 'Comando rechazado: solo puedo ejecutar comandos dentro del workspace de Shinobi.';
}

const runCommandTool: Tool = {
  name: 'run_command',
  description: 'Execute a shell command (CMD or PowerShell) on Windows and return its output. Use for: running scripts, checking versions, installing packages, git operations, etc. Commands run in the current working directory.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute (e.g. "node --version", "dir", "git status")' },
      cwd: { type: 'string', description: 'Optional: working directory for the command (defaults to current directory)' },
      timeout: { type: 'number', description: 'Optional: timeout in milliseconds (defaults to 30000)' },
    },
    required: ['command'],
  },

  requiresConfirmation(args: { command: string }) {
    return isDangerousCommand(args.command);
  },

  async execute(args: { command: string; cwd?: string; timeout?: number }): Promise<ToolResult> {
    const timeout = args.timeout || 30_000;
    const cwd = args.cwd || process.cwd();

    const destructiveError = checkDestructive(args.command);
    if (destructiveError) {
      return { success: false, output: '', error: destructiveError };
    }

    const sandboxError = checkSandbox(args.command, cwd);
    if (sandboxError) {
      return { success: false, output: '', error: sandboxError };
    }

    // Sprint 1.4 — Multi-backend de ejecución. Si SHINOBI_RUN_BACKEND
    // apunta a algo distinto de 'local', delegamos al backend pedido
    // (docker, ssh, modal, daytona, e2b, mock). La ruta `local` cae al
    // exec directo de abajo para no añadir overhead a la mayoría de
    // ejecuciones.
    const wantBackend = (process.env.SHINOBI_RUN_BACKEND || 'local').toLowerCase();
    if (wantBackend !== 'local') {
      const { sandboxRegistry } = await import('../sandbox/registry.js');
      const backend = sandboxRegistry().get(wantBackend as any);
      if (backend) {
        const r = await backend.run({ command: args.command, cwd, timeoutMs: timeout });
        const output = [
          `$ ${args.command} (backend=${r.backend}, ${r.durationMs}ms)`,
          r.stdout?.trim() || '',
          r.stderr?.trim() ? `STDERR: ${r.stderr.trim()}` : '',
          `Exit code: ${r.exitCode}`,
        ].filter(Boolean).join('\n');
        return {
          success: r.success,
          output,
          error: r.success ? undefined : `Command failed on backend ${r.backend} (exit ${r.exitCode}): ${r.stderr?.trim() || 'unknown'}`,
        };
      }
      console.warn(`[run_command] SHINOBI_RUN_BACKEND='${wantBackend}' no reconocido; fallback a local.`);
    }

    return new Promise((resolve) => {
      exec(args.command, { cwd, timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const exitCode = error?.code ?? 0;
        const output = [
          `$ ${args.command}`,
          stdout?.trim() || '',
          stderr?.trim() ? `STDERR: ${stderr.trim()}` : '',
          `Exit code: ${exitCode}`,
        ].filter(Boolean).join('\n');

        resolve({
          success: !error,
          output,
          error: error ? `Command failed (exit ${exitCode}): ${stderr?.trim() || error.message}` : undefined,
        });
      });
    });
  },
};

registerTool(runCommandTool);
export default runCommandTool;
