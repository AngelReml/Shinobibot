import * as path from 'path';

/**
 * Validates if a file path is safe to access.
 * Prevents directory traversal attacks and restricts access to the workspace.
 */
export function validatePath(requestedPath: string, mode: 'read' | 'write' = 'read') {
  // In a real production system, this should be tightly bound to the actual workspace root.
  // For Shinobibot, we use the current working directory as the workspace root.
  const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
  
  const resolvedPath = path.resolve(requestedPath);
  
  // Basic directory traversal check
  if (!resolvedPath.startsWith(workspaceRoot)) {
    return {
      allowed: false,
      reason: `Access denied: Path ${resolvedPath} is outside the workspace root (${workspaceRoot}).`
    };
  }

  // Prevent accessing sensitive system files directly
  const sensitivePaths = [
    '/etc/passwd', '/etc/shadow', '/root', '/var/log',
    'C:\\Windows\\System32', 'C:\\Windows\\System',
  ];
  
  if (sensitivePaths.some(p => resolvedPath.toLowerCase().startsWith(p.toLowerCase()))) {
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
    /\bformat\b/i,             // Format (Windows)
    /\bdd\s+if=/i,             // Direct disk copy
    /\bshutdown\b/i,           // Shutdown
    /\breboot\b/i,            // Reboot
    />\s*\/dev\/sd[a-z]\b/i,   // Overwrite block device
    /\bmv\s+.*\/dev\/null/i,   // Move to null
  ];

  return dangerousPatterns.some(pattern => pattern.test(command));
}
