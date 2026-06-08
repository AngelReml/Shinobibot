import * as path from 'path';
import { contextWorkspaceRoot } from '../agents/exec_context.js';

/**
 * Validates if a file path is safe to access.
 * Prevents directory traversal attacks and restricts access to the workspace.
 */
/**
 * Rutas de sistema sensibles que se rechazan siempre, estén o no dentro del
 * workspace. Exportada para que los smoke tests (d017) la ejerciten.
 */
export const ABSOLUTE_PROHIBITED_PATHS = [
  '/etc/passwd', '/etc/shadow', '/etc/sudoers', '/root', '/var/log',
  'C:\\Windows\\System32', 'C:\\Windows\\System', 'C:\\Windows\\SysWOW64',
];

/**
 * True si `child` es el propio `parent` o está contenido dentro de él.
 * Robusto frente al bypass por prefijo de hermano (workspace "C:\app" NO
 * debe permitir "C:\app-evil\x"): se compara con `path.relative`, no con
 * `startsWith`.
 */
function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  // rel === '' → es el propio directorio. rel que empieza por '..' o es
  // absoluto → está fuera.
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Workspace root efectivo, siempre resuelto. Respeta el contexto de ejecución
 * por-agente (Team): dentro de runInContext devuelve el workspaceRoot de ese
 * agente; fuera, equivale a WORKSPACE_ROOT||cwd (comportamiento de siempre).
 */
function workspaceRoot(): string {
  return path.resolve(contextWorkspaceRoot());
}

/**
 * True si el path resuelto cae FUERA del workspace root. Usado por el gate
 * de aprobación para clasificar una escritura fuera del workspace como
 * operación que requiere autorización explícita del usuario.
 */
export function isOutsideWorkspace(requestedPath: string): boolean {
  return !isInsideDir(workspaceRoot(), path.resolve(requestedPath));
}

/**
 * Paths fuera del workspace que el usuario aprobó EXPLÍCITAMENTE en el chat
 * durante esta sesión. `validatePath` los deja pasar pese a estar fuera del
 * workspace — la aprobación manual desbloquea el path traversal para esa
 * operación concreta. Sin aprobación, el bloqueo se mantiene.
 *
 * Nota de seguridad: esto NUNCA desbloquea `ABSOLUTE_PROHIBITED_PATHS`
 * (System32, /etc/shadow, …) — esos siguen siendo un bloqueo duro aunque el
 * usuario los apruebe.
 */
const sessionApprovedPaths = new Set<string>();

/**
 * Registra un path como aprobado manualmente para esta sesión. Se normaliza
 * con `path.resolve` para que coincida con la comprobación de `validatePath`.
 */
export function approvePathForSession(requestedPath: string): void {
  sessionApprovedPaths.add(path.resolve(requestedPath));
}

/** True si el path fue aprobado manualmente en esta sesión. */
export function isPathManuallyApproved(requestedPath: string): boolean {
  return sessionApprovedPaths.has(path.resolve(requestedPath));
}

/** Olvida todas las aprobaciones manuales (p. ej. al cambiar de sesión). */
export function clearApprovedPaths(): void {
  sessionApprovedPaths.clear();
}

export function validatePath(requestedPath: string, mode: 'read' | 'write' = 'read') {
  // In a real production system, this should be tightly bound to the actual workspace root.
  // For Shinobibot, we use the current working directory as the workspace root.
  const root = workspaceRoot();

  const resolvedPath = path.resolve(requestedPath);

  // Aprobación manual: si el usuario autorizó explícitamente este path en el
  // chat, el límite del workspace se desbloquea SOLO para esa operación. La
  // lista ABSOLUTE_PROHIBITED_PATHS de más abajo sigue siendo un bloqueo duro.
  const manuallyApproved = sessionApprovedPaths.has(resolvedPath);

  // Directory traversal check — usa path.relative para que un directorio
  // hermano con prefijo común NO pase el filtro (bug C5 de la auditoría).
  if (!manuallyApproved && !isInsideDir(root, resolvedPath)) {
    return {
      allowed: false,
      reason: `Access denied: Path ${resolvedPath} is outside the workspace root (${root}). ` +
        `Si el usuario aprueba la operación explícitamente en el chat, el path se desbloqueará para ella.`
    };
  }

  // Prevent accessing sensitive system files directly. Se comprueba con
  // límite de segmento (no startsWith pelado) para no rechazar de más.
  const lowered = resolvedPath.toLowerCase();
  const hit = ABSOLUTE_PROHIBITED_PATHS.some(p => {
    const lp = p.toLowerCase();
    return lowered === lp || lowered.startsWith(lp + '\\') || lowered.startsWith(lp + '/');
  });
  if (hit) {
    return { allowed: false, reason: `Access denied: Sensitive system path.` };
  }

  return { allowed: true };
}

/**
 * Checks if a command might be dangerous and requires explicit user confirmation.
 */
export function isDangerousCommand(command: string): boolean {
  const dangerousPatterns = [
    /\brm\s+-rf\b/i,          // Recursive delete
    /\bdel\s+\/s\b/i,          // Recursive delete (Windows)
    /\bmkfs\b/i,               // Format filesystem
    /\bformat\s+[a-z]:/i,      // Format a drive — `format C:` (no `npm run format`)
    /\bdd\s+if=/i,             // Direct disk copy
    /\bshutdown\b/i,           // Shutdown
    /\breboot\b/i,            // Reboot
    />\s*\/dev\/sd[a-z]\b/i,   // Overwrite block device
    /\bmv\s+.*\/dev\/null/i,   // Move to null
  ];

  return dangerousPatterns.some(pattern => pattern.test(command));
}
