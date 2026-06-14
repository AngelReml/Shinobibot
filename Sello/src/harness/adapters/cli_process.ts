/**
 * harness/adapters/cli_process.ts — minimal subject adapter (CONTRACT F0).
 *
 * Invokes a subject as a child process and captures stdout. The task prompt is
 * written to the subject's stdin; the task_id is exposed via the SELLO_TASK_ID
 * env var. stdout is the subject's raw output (the "evidence").
 *
 * This is the only adapter in F0. It is a PURE transport: it runs a process and
 * reads bytes back. It contains NO grading logic.
 */

import { spawn } from 'node:child_process';
import { canonicalHash } from '../../core/ledger/canonical.ts';

export interface AdapterResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  invocation_digest: string;   // "sha256:..." over the invocation parameters
}

export interface CliProcessOptions {
  command: string;             // shell command line to execute (the subject)
  taskId: string;
  prompt: string;
  timeoutMs?: number;
}

export function invocationDigest(command: string, taskId: string): string {
  return `sha256:${canonicalHash({ adapter: 'cli-process', command, task_id: taskId })}`;
}

export function runCliProcess(opts: CliProcessOptions): Promise<AdapterResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const digest = invocationDigest(opts.command, opts.taskId);

  return new Promise((resolve) => {
    const child = spawn(opts.command, {
      shell: true,
      env: { ...process.env, SELLO_TASK_ID: opts.taskId },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout, stderr: stderr + `\n[adapter spawn error] ${err.message}`,
        exit_code: null, timed_out: timedOut, invocation_digest: digest,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout, stderr, exit_code: code, timed_out: timedOut, invocation_digest: digest,
      });
    });

    // Feed the prompt on stdin, then close it.
    try {
      child.stdin.write(opts.prompt);
      child.stdin.end();
    } catch { /* subject may not read stdin; ignore */ }
  });
}
