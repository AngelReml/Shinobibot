/**
 * RunCommand Tool — Execute a shell command with safety checks
 */
import { realpathSync } from 'fs';
import { resolve as resolvePath, sep } from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { isDangerousCommand, ABSOLUTE_PROHIBITED_PATHS } from '../utils/permissions.js';
import { contextCwd, contextWorkspaceRoot } from '../agents/exec_context.js';

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

const PROHIBITED_PATH_MSG =
  'Comando rechazado: hace referencia a una ruta de sistema sensible bloqueada.';

// ALTA-01 (auditoría 2026-06-30): `git`/`tsc` ya NO se eximen en bloque del
// check de `cwd` — `git clone <url> /fuera`, `git config --global ...` o
// `tsc --outDir /fuera` no son read-only y escapaban el sandbox. Solo un
// subconjunto de subcomandos de git verdaderamente de solo lectura puede
// operar fuera del workspace raíz (ej. `git status`/`git log` en otro repo).
const GIT_READONLY_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files',
  'describe', 'blame', 'shortlog', 'ls-remote',
]);

function isGitReadonlyInvocation(command: string): boolean {
  if (firstToken(command) !== 'git') return false;
  const rest = command.trim().replace(/^["']?git["']?/i, '').trim();
  const sub = (rest.match(/^[^\s"']+/)?.[0] || '').toLowerCase();
  return GIT_READONLY_SUBCOMMANDS.has(sub);
}

function normalizeDir(p: string): string {
  // resolvePath devuelve absoluto (puramente léxico). CRIT-03: un symlink
  // creado DENTRO del workspace puede apuntar a `/etc` o `C:\Windows`; el SO
  // sigue ese symlink al hacer `chdir()` en exec(), así que comparar solo la
  // ruta léxica deja pasar el ataque. `realpathSync` resuelve symlinks igual
  // que hará el proceso real. Si el path no existe todavía, se usa la forma
  // léxica como fallback (comportamiento previo).
  const abs = resolvePath(p);
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    // No existe (aún) — sin symlink que resolver, se mantiene `abs`.
  }
  return real.endsWith(sep) ? real.slice(0, -1) : real;
}

/**
 * Colapsa subshells POSIX `$(...)` (balanceados, incluso anidados) y bloques
 * entre backticks `` `...` `` a cadena vacía. CRIT-01: el atacante usa un
 * subshell vacío para partir un token destructivo en dos sin romper la
 * sintaxis (`rm$(echo -n) -rf /workspace` se ejecuta como `rm -rf /workspace`
 * pero el regex `\brm\s+-[a-z]*[rf]` no lo detecta porque no hay whitespace
 * inmediato tras `rm`). Colapsar el subshell a vacío reconstruye el comando
 * tal y como lo verá el shell en el peor caso y permite que los patrones
 * destructivos lo detecten.
 */
function collapseSubshells(command: string): string {
  const withoutBackticks = command.replace(/`[^`]*`/g, '');
  let out = '';
  for (let i = 0; i < withoutBackticks.length; i++) {
    if (withoutBackticks[i] === '$' && withoutBackticks[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < withoutBackticks.length && depth > 0) {
        if (withoutBackticks[j] === '(') depth++;
        else if (withoutBackticks[j] === ')') depth--;
        j++;
      }
      i = j - 1; // salta todo el subshell, se sustituye por cadena vacía
      continue;
    }
    out += withoutBackticks[i];
  }
  return out;
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
  // CRIT-01: además de la normalización de arriba (que solo quita los
  // caracteres de comilla/backtick mantiendo su contenido — necesario para
  // detectar `k`i`ll`), evaluamos una segunda variante con los subshells
  // `$(...)`/`` `...` `` colapsados a vacío, que es como se ejecutaría en el
  // peor caso (`rm$(echo -n) -rf` → `rm -rf`). Un comando se bloquea si
  // CUALQUIERA de las dos variantes hace match.
  const collapsed = collapseSubshells(command).replace(/['"^]/g, '');
  for (const variant of [norm, collapsed]) {
    for (const pat of DESTRUCTIVE_PATTERNS) {
      if (pat.test(variant)) return DESTRUCTIVE_MSG;
    }
    // Segunda capa: patrones destructivos de utils/permissions.
    if (isDangerousCommand(variant)) return DESTRUCTIVE_MSG;
  }
  return null;
}

/**
 * CRIT-02: `ABSOLUTE_PROHIBITED_PATHS` (de utils/permissions, la misma lista
 * que bloquea `read_file`/`write_file`) no se comprobaba contra el texto del
 * comando — `cat /etc/shadow` o `curl file:///etc/passwd` pasaban libres
 * porque `checkSandbox` solo mira el argumento `cwd`, nunca el cuerpo del
 * comando. Buscamos cada ruta prohibida como substring de palabra completa
 * (el carácter inmediatamente antes/después, si existe, no puede ser
 * alfanumérico ni `_`) para no bloquear de más (ej. `/etc/passwd-old`) ni de
 * menos (comillas/backslashes alrededor).
 */
export function checkProhibitedPaths(command: string): string | null {
  const lowered = command.toLowerCase();
  // Un carácter de "continuación de nombre" (alfanumérico, `_`, `-`, `.`)
  // inmediatamente antes/después NO es un boundary — así "/etc/passwd-old.bak"
  // (un archivo distinto, con prefijo compartido) no se confunde con
  // "/etc/passwd". Separadores de path, espacios, comillas, fin de cadena, etc.
  // sí cuentan como boundary.
  const isBoundary = (ch: string) => ch === '' || !/[a-z0-9_\-.]/i.test(ch);
  for (const prohibited of ABSOLUTE_PROHIBITED_PATHS) {
    const needle = prohibited.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lowered.indexOf(needle, from);
      if (idx === -1) break;
      const before = idx > 0 ? lowered[idx - 1] : '';
      const after = idx + needle.length < lowered.length ? lowered[idx + needle.length] : '';
      if (isBoundary(before) && isBoundary(after)) return PROHIBITED_PATH_MSG;
      from = idx + 1;
    }
  }
  return null;
}

// MEDIA-01: tope superior de timeout — sin cap, `{timeout: 2147483647}` sobre
// un comando bloqueante (`sleep infinity`, `nc -l 4444`) monopolizaba el
// proceso indefinidamente. 5 minutos es generoso para builds/instalaciones
// normales sin permitir un DoS de disponibilidad.
export const MAX_TIMEOUT_MS = 300_000;

/** Aplica el default (30s) y el cap superior (`MAX_TIMEOUT_MS`) al timeout pedido. */
export function clampTimeout(requested: number | undefined): number {
  return Math.min(requested || 30_000, MAX_TIMEOUT_MS);
}

/** Devuelve mensaje de error si el cwd cae fuera del sandbox, o null si pasa. */
export function checkSandbox(command: string, cwd: string): string | null {
  // Respeta el contexto de ejecución por-agente (Team). Sin contexto equivale a
  // WORKSPACE_ROOT||cwd y process.cwd() (comportamiento de siempre).
  const workspaceRoot = normalizeDir(contextWorkspaceRoot());
  const shinobiRoot = normalizeDir(contextCwd());
  const target = normalizeDir(cwd);

  if (workspaceRoot && isInside(target, workspaceRoot)) return null;
  if (isInside(target, shinobiRoot)) return null;

  // Excepción: ALTA-01 — solo subcomandos de git VERDADERAMENTE read-only
  // (status/log/diff/show/...) pueden operar fuera del workspace raíz. Antes
  // se eximía el binario `git` (y `tsc`) entero, lo que dejaba pasar
  // `git clone <url> /fuera`, `git config --global core.sshCommand "..."` o
  // `tsc --outDir /fuera` sin validar `cwd`. `tsc` ya no tiene excepción:
  // escribe artefactos arbitrarios y no hay un subconjunto read-only que
  // distinguir como con git.
  if (isGitReadonlyInvocation(command)) return null;

  return 'Comando rechazado: solo puedo ejecutar comandos dentro del workspace de Shinobi.';
}

const runCommandTool: Tool = {
  name: 'run_command',
  description: 'Execute a shell command and return its output. On Windows, use PowerShell syntax (Get-Process, Get-ChildItem, etc.) and pass shell="powershell". Default on Windows is auto-PowerShell. Use for: running scripts, checking versions, installing packages, git operations, system queries, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute. On Windows use PowerShell syntax (e.g. "Get-Process | ConvertTo-Json", "Get-ChildItem C:\\\\", "Get-Service | Where-Object Status -eq Running")' },
      cwd: { type: 'string', description: 'Optional: working directory for the command (defaults to current directory)' },
      timeout: { type: 'number', description: 'Optional: timeout in milliseconds (defaults to 30000)' },
      shell: { type: 'string', enum: ['auto', 'cmd', 'powershell'], description: 'Shell to use: "powershell" routes via powershell.exe (safe Base64 encoding, no injection), "cmd" forces cmd.exe, "auto" uses PowerShell on Windows and the OS default on Linux. Default: "auto".' },
    },
    required: ['command'],
  },

  requiresConfirmation(args: { command: string }) {
    // MEDIA-04: `checkDestructive` bloquea en duro con 24 patrones (más la
    // lista de `isDangerousCommand`), pero antes solo se pedía confirmación
    // con los 8 patrones de `isDangerousCommand`. Eso dejaba comandos como
    // `pkill`/`taskkill`/`reboot` fallar en silencio: el usuario nunca veía
    // que el agente lo intentó. Pedimos confirmación si CUALQUIERA de las
    // dos detecta riesgo, así el intento siempre es visible antes o junto
    // con el bloqueo duro.
    return isDangerousCommand(args.command) || checkDestructive(args.command) !== null;
  },

  async execute(args: { command: string; cwd?: string; timeout?: number; shell?: string }): Promise<ToolResult> {
    const timeout = clampTimeout(args.timeout);
    const cwd = args.cwd || contextCwd();

    const destructiveError = checkDestructive(args.command);
    if (destructiveError) {
      return { success: false, output: '', error: destructiveError };
    }

    const prohibitedPathError = checkProhibitedPaths(args.command);
    if (prohibitedPathError) {
      return { success: false, output: '', error: prohibitedPathError };
    }

    const sandboxError = checkSandbox(args.command, cwd);
    if (sandboxError) {
      return { success: false, output: '', error: sandboxError };
    }

    // Sprint 1.4 — Multi-backend de ejecución, seleccionable por
    // SHINOBI_RUN_BACKEND (default 'local'). Si el operador pidió
    // explícitamente un backend NO-local (docker/ssh/e2b/mock), se delega
    // ahí sin más — esos backends no tienen concepto de "shell de Windows".
    // P1.E1 (plan de frontera): la ejecución entra por el Monitor de
    // Referencia (`mediatedEffect`), no tocando el registry directo. El
    // import dinámico se conserva: hay un ciclo real de módulos
    // (sandbox/backends/local.ts importa los checks DE este fichero).
    const wantBackend = (process.env.SHINOBI_RUN_BACKEND || 'local').toLowerCase();
    if (wantBackend !== 'local') {
      const { mediatedEffect } = await import('../sandbox/monitor.js');
      const res = await mediatedEffect({
        kind: 'shell',
        rawCommandLine: true,
        target: args.command,
        cwd,
        timeoutMs: timeout,
        backendId: wantBackend,
        reversible: false,
      });
      if (res.ok) {
        const r = res.run;
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
      // Backend pedido explícitamente pero desconocido: NO se cae a `local`
      // en silencio — eso rompería la promesa de aislamiento (el usuario
      // creería ejecutar aislado y correría en su host). Se devuelve error.
      return {
        success: false,
        output: '',
        error: `SHINOBI_RUN_BACKEND='${wantBackend}' no es un backend reconocido. ` +
          `Backends válidos: local, docker, ssh, e2b, mock. ` +
          `No se ejecuta en 'local' por seguridad (rompería el aislamiento esperado).`,
      };
    }

    // Fase 2 — D1 Windows: si el caller pide PowerShell, o si es auto y
    // estamos en Windows, enrutamos por el backend 'powershell' (Base64
    // -EncodedCommand, sin inyección de cmd.exe, y desde F1.1 también con env
    // allowlist + redacción de output — ver _powershell.ts). Esta es la ruta
    // real por defecto en el host Windows nativo del producto.
    //
    // P1.E4 (plan de frontera 2026-07-01): antes esta rama llamaba a
    // `runPowerShell()` directo — la única brecha real del monitor en Windows
    // (documentada en `monitor.ts`), porque era el camino de MAYOR tráfico
    // del producto y el único que esquivaba `mediatedEffect`. Ahora entra por
    // el Monitor de Referencia igual que el resto: mismo `runPowerShell()`
    // por debajo (`PowerShellBackend`), cero cambio de comportamiento, solo
    // cambia el camino — auditado, con el mismo chokepoint que 'local'.
    const shellMode = (args.shell || 'auto').toLowerCase();
    const usePowerShell = shellMode === 'powershell' ||
      (shellMode === 'auto' && process.platform === 'win32');

    if (usePowerShell) {
      const { mediatedEffect } = await import('../sandbox/monitor.js');
      const res = await mediatedEffect({
        kind: 'shell',
        rawCommandLine: true,
        target: args.command,
        cwd,
        timeoutMs: timeout,
        backendId: 'powershell',
        reversible: false,
      });
      if (!res.ok) {
        // Solo alcanzable si 'powershell' desapareciera del registry (tests
        // que lo vacían) o el mandato de misión lo deniega (E3.a).
        return { success: false, output: '', error: `Backend 'powershell' no disponible: ${res.detail}` };
      }
      const r = res.run;
      const output = [
        `PS> ${args.command}`,
        r.stdout.trim() || '',
        r.stderr.trim() ? `STDERR: ${r.stderr.trim()}` : '',
        `Exit code: ${r.exitCode}`,
      ].filter(Boolean).join('\n');
      return {
        success: r.success,
        output,
        error: r.success ? undefined : `PowerShell command failed (exit ${r.exitCode}): ${r.stderr.trim() || 'unknown error'}`,
      };
    }

    // F1.1 (auditoría 2026-07): caso 'local' sin PowerShell (shell='cmd'
    // explícito, o 'auto' en un host no-Windows). Antes esta rama tenía su
    // PROPIO `exec()` inline, duplicado del de `LocalBackend` pero SIN sus
    // defensas (env allowlist, redacción de output, blacklist/jail — las
    // de arriba ya se aplicaron, pero el env/redacción NO existían aquí).
    // Delega en `LocalBackend` (única implementación de 'local' del repo),
    // desde P1.E1 a través del Monitor de Referencia — mismo backend, mismo
    // RunInput, cero cambio de comportamiento; solo cambia el camino.
    const { mediatedEffect } = await import('../sandbox/monitor.js');
    const res = await mediatedEffect({
      kind: 'shell',
      rawCommandLine: true,
      target: args.command,
      cwd,
      timeoutMs: timeout,
      backendId: 'local',
      reversible: false,
    });
    if (!res.ok) {
      // Solo alcanzable si 'local' desapareciera del registry (imposible con
      // registerDefaults, posible en tests que lo vacían): fail-loud.
      return { success: false, output: '', error: `Backend 'local' no disponible: ${res.detail}` };
    }
    const r = res.run;
    const output = [
      `$ ${args.command}`,
      r.stdout?.trim() || '',
      r.stderr?.trim() ? `STDERR: ${r.stderr.trim()}` : '',
      `Exit code: ${r.exitCode}`,
    ].filter(Boolean).join('\n');
    return {
      success: r.success,
      output,
      error: r.success ? undefined : `Command failed (exit ${r.exitCode}): ${r.stderr?.trim() || 'unknown error'}`,
    };
  },
};

registerTool(runCommandTool);
export default runCommandTool;
