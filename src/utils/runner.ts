import { execSync } from 'child_process';

/**
 * Runner utility for Shinobibot to execute system commands.
 * This is used to trigger the OpenGravity Kernel and other CLI tools.
 */
export async function run_command(command: string, cwd: string = process.cwd()): Promise<string> {
  try {
    console.log(`[Runner] Executing: ${command}`);
    const output = execSync(command, { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return output;
  } catch (error: any) {
    const stderr = error.stderr ? error.stderr.toString() : '';
    const stdout = error.stdout ? error.stdout.toString() : '';
    throw new Error(`Command failed: ${command}\nError: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`);
  }
}
