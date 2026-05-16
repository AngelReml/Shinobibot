/**
 * Task Scheduler Create — crea una tarea programada de Windows con
 * `schtasks.exe`. Útil para automatizaciones recurrentes (tier S #12:
 * persistent missions complete).
 *
 * Política de seguridad:
 *   - Sin /RU SYSTEM o cuentas privilegiadas — solo el usuario actual.
 *   - El comando a ejecutar (/TR) se valida contra la misma blacklist
 *     destructiva que run_command (Stop-Process, kill, taskkill, etc.).
 *   - El nombre de la tarea (/TN) no admite caracteres que rompan la
 *     línea de comandos.
 */
import { execFile } from 'child_process';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { checkDestructive } from './run_command.js';

const VALID_SCHEDULES = ['ONCE', 'MINUTE', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ONLOGON', 'ONIDLE'];

function isValidTaskName(name: string): boolean {
  // schtasks acepta letras, números, espacios, guiones y subrayados.
  return /^[\w\s\-]{1,128}$/.test(name);
}

/**
 * Ejecuta schtasks.exe vía execFile (sin cmd.exe). Cada elemento de `args`
 * llega a schtasks como un argv independiente — un valor con comillas o
 * metacaracteres de shell NO puede romper la línea de comandos ni inyectar
 * comandos. Antes se construía un string y se pasaba a exec() con un escape
 * `\"` inválido para cmd.exe (mismo defecto que el bug C3 de _powershell).
 */
function runSchtasks(args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('schtasks.exe', args, { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        code: (err?.code as number) ?? 0,
      });
    });
  });
}

const tool: Tool = {
  name: 'task_scheduler_create',
  description: 'Create a Windows scheduled task via schtasks.exe. The task runs under the current user only (no SYSTEM). The command to run is checked against the destructive command blacklist before being scheduled.',
  parameters: {
    type: 'object',
    properties: {
      taskName: { type: 'string', description: 'Unique name for the scheduled task (alphanumeric, spaces, dashes, underscores; max 128 chars).' },
      command: { type: 'string', description: 'Full command line to execute (e.g. "powershell.exe -File C:\\path\\to\\script.ps1"). Blacklist-checked.' },
      schedule: { type: 'string', description: 'Schedule frequency: ONCE | MINUTE | HOURLY | DAILY | WEEKLY | MONTHLY | ONLOGON | ONIDLE.' },
      modifier: { type: 'string', description: 'Optional: numeric modifier for the schedule (e.g. "5" for every 5 minutes when MINUTE).' },
      startTime: { type: 'string', description: 'Optional: HH:mm start time (defaults to schtasks default).' },
    },
    required: ['taskName', 'command', 'schedule'],
  },

  requiresConfirmation() {
    return true;
  },

  async execute(args: {
    taskName: string;
    command: string;
    schedule: string;
    modifier?: string;
    startTime?: string;
  }): Promise<ToolResult> {
    if (!isValidTaskName(args.taskName)) {
      return { success: false, output: '', error: 'taskName inválido: solo letras, números, espacios, "-" o "_" hasta 128 chars.' };
    }
    const scheduleUpper = args.schedule.toUpperCase();
    if (!VALID_SCHEDULES.includes(scheduleUpper)) {
      return { success: false, output: '', error: `schedule inválido. Permitidos: ${VALID_SCHEDULES.join(', ')}.` };
    }
    const destructive = checkDestructive(args.command);
    if (destructive) {
      return { success: false, output: '', error: destructive };
    }
    // Argumentos para schtasks como argv independientes (sin shell). taskName
    // ya está validado contra [\w\s\-]; command va como un único argv —
    // comillas y metacaracteres dentro de él son datos, no se interpretan.
    const sargs: string[] = [
      '/CREATE',
      '/TN', args.taskName,
      '/TR', args.command,
      '/SC', scheduleUpper,
      '/F', // force, sobrescribe si ya existe (idempotente).
    ];
    if (args.modifier && /^\d+$/.test(args.modifier)) {
      sargs.push('/MO', args.modifier);
    }
    if (args.startTime && /^\d{2}:\d{2}$/.test(args.startTime)) {
      sargs.push('/ST', args.startTime);
    }
    const r = await runSchtasks(sargs);
    if (!r.ok) {
      return { success: false, output: r.stdout, error: r.stderr.trim() || `schtasks exit ${r.code}` };
    }
    return { success: true, output: r.stdout.trim() || `Task "${args.taskName}" creada (${scheduleUpper}).` };
  },
};

registerTool(tool);
export default tool;
export { isValidTaskName };
