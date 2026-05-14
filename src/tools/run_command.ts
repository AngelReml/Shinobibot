/**
 * RunCommand Tool — Execute a shell command with safety checks
 */
import { exec } from 'child_process';
import { resolve as resolvePath, sep } from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { isDangerousCommand } from '../utils/permissions.js';
import { isDockerAvailable, runInDocker } from './_docker_backend.js';

// Patrones destructivos NO configurables por el LLM. Si el command crudo
// contiene cualquiera de estos (case-insensitive), se rechaza antes de
// ejecutar — esto incluye sustituir un mock por sed/awk.
const DESTRUCTIVE_PATTERNS: string[] = [
  'stop-process',
  'kill',
  'taskkill',
  'wmic process',
  'pkill',
  'killall',
  'rm -rf',
  'rmdir /s',
  'format',
  'del /f',
];

// Comandos puramente de lectura/build que pueden operar fuera del workspace
// raíz (ej. tsc compilando un proyecto adyacente, git status en otro repo).
const READONLY_LEADERS = new Set(['git', 'node', 'npx', 'tsc']);

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
  const lower = command.toLowerCase();
  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (lower.includes(pat)) {
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
  // proyecto aunque queden fuera del workspace raíz.
  if (READONLY_LEADERS.has(firstToken(command))) return null;

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

    // Backend Docker opcional (Tier A #13). Si el operador pidió
    // SHINOBI_RUN_BACKEND=docker, intentamos ejecutar dentro de container
    // ephemeral. Si Docker no está disponible, log warning + fallback al
    // host (mejor algo que nada — el operador puede ver el log y decidir).
    if (process.env.SHINOBI_RUN_BACKEND === 'docker') {
      const dock = await isDockerAvailable();
      if (dock.available) {
        const r = await runInDocker({ command: args.command, cwd, timeoutMs: timeout });
        const output = [
          `$ ${args.command} (in container)`,
          r.stdout?.trim() || '',
          r.stderr?.trim() ? `STDERR: ${r.stderr.trim()}` : '',
          `Exit code: ${r.exitCode}`,
        ].filter(Boolean).join('\n');
        return {
          success: r.success,
          output,
          error: r.success ? undefined : `Command failed in container (exit ${r.exitCode}): ${r.stderr?.trim() || 'unknown'}`,
        };
      }
      console.warn(`[run_command] SHINOBI_RUN_BACKEND=docker pero docker no disponible (${dock.error}). Fallback al host.`);
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
