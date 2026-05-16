/**
 * RunCommand Tool — Execute a shell command with safety checks
 */
import { exec } from 'child_process';
import { resolve as resolvePath, sep } from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { isDangerousCommand } from '../utils/permissions.js';

// Patrones destructivos NO configurables por el LLM. Si el command (tras
// normalizar) hace match con cualquiera de estos, se rechaza antes de
// ejecutar. Regex con límites de palabra: cubre más casos que el `includes`
// de substring anterior y a la vez evita falsos positivos (`npm run format`,
// `skill`, `string.format()` ya no se bloquean por error).
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // Matar procesos
  /\bstop-process\b/i,
  /\btaskkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\bkill\b\s+-?\d/i,                       // kill 1234 / kill -9 1234
  /\bwmic\s+process\b/i,
  /\bget-process\b[^\n|]*\|\s*stop-process/i,
  // Borrado masivo / recursivo
  /\brm\s+-[a-z]*[rf]/i,                    // rm -rf, rm -fr, rm -r -f
  /\brmdir\s+\/s/i,
  /\brd\s+\/s/i,
  /\bdel\s+\/[sfq]/i,
  /\bremove-item\b[^\n]*-(recurse|force)/i,
  /\bclear-content\b/i,
  /\b(get-childitem|gci|ls|dir)\b[^\n|]*\|\s*remove-item/i,
  // Formateo / disco
  /\bformat\s+[a-z]:/i,                      // format C:
  /\bformat-volume\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdiskpart\b/i,
  /\bcipher\s+\/w/i,
  />\s*\/dev\/(sd[a-z]|nvme|disk)/i,
  // Registro / sistema
  /\breg\s+delete\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bchmod\s+-[a-z]*r/i,                     // chmod -R sobre árboles
  // Fork bomb
  /:\s*\(\s*\)\s*\{/,
  // PowerShell base64 — no se puede inspeccionar el payload, se rechaza.
  /\s-e(nc|ncodedcommand)?\b\s+[a-z0-9+/=]{16,}/i,
];

const DESTRUCTIVE_MSG =
  'Comando rechazado: esta acción podría dañar el sistema. Pide al usuario que lo haga manualmente si es necesario.';

// Comandos puramente de lectura/build que pueden operar fuera del workspace
// raíz (ej. tsc compilando un proyecto adyacente, git status en otro repo).
// `node`/`npx` se EXCLUYEN a propósito: ejecutan código arbitrario y burlarían
// el sandbox de cwd (hallazgo HIGH de la auditoría 2026-05-16).
const READONLY_LEADERS = new Set(['git', 'tsc']);

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
  // Normaliza: quita comillas, backticks y el `^` de escape de cmd.exe para
  // que evasiones triviales (ki"ll, t^askkill, k`i`ll) no esquiven la lista.
  const norm = command.replace(/['"`^]/g, '');
  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (pat.test(norm)) return DESTRUCTIVE_MSG;
  }
  // Segunda capa: patrones destructivos de utils/permissions.
  if (isDangerousCommand(norm)) return DESTRUCTIVE_MSG;
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
