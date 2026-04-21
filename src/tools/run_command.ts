/**
 * RunCommand Tool — Execute a shell command with safety checks
 */
import { exec } from 'child_process';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { isDangerousCommand } from '../utils/permissions.js';

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
