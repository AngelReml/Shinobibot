import * as path from 'path';

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

export function validatePath(requestedPath: string, mode: 'read' | 'write' = 'read') {
  // In a real production system, this should be tightly bound to the actual workspace root.
  // For Shinobibot, we use the current working directory as the workspace root.
  const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());

  const resolvedPath = path.resolve(requestedPath);

  // Directory traversal check — usa path.relative para que un directorio
  // hermano con prefijo común NO pase el filtro (bug C5 de la auditoría).
  if (!isInsideDir(workspaceRoot, resolvedPath)) {
    return {
      allowed: false,
      reason: `Access denied: Path ${resolvedPath} is outside the workspace root (${workspaceRoot}).`
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
