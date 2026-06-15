/**
 * kaname/live.ts — enchufa las puntas vivas del Kaname al runtime real (⚑):
 *   - makeFsKernelHost: el KernelHost real tras el mediator — readInput/writeOutput
 *     sobre ficheros reales (confinados a un root), invokeTool vía un dispatcher
 *     inyectado, requestApproval vía el approval gate real, log al sink.
 *   - makeClaudeLauncher: el LaunchClaude real — lanza Claude Code como subproceso en
 *     el worktree del worker, detecta sus escrituras por `git status`, con backoff
 *     ante rate limits del plan (§7.3).
 *   - createWorktree/removeWorktree: workspaces git disjuntos por worker (sin colisión).
 *
 * Toda ejecución de subproceso pasa por un `Exec` inyectable (default = sandbox local
 * real), así el módulo es testeable sin Claude/git de verdad y seguro por construcción.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sandboxRegistry } from '../sandbox/registry.js';
import { requestApproval, isReadOnly, type Asker } from '../security/approval.js';
import { effectRank } from '../integrity/effects.js';
import type { KernelHost } from './mediator.js';
import type { LaunchClaude, WorkerResult } from './swarm.js';
import type { Artifact, ProtectedAction, SkillEvent, SwarmWorker } from './types.js';

export type Exec = (command: string, cwd: string, timeoutMs: number) => Promise<{ success: boolean; stdout: string; stderr: string }>;

/** Default executor: the real local sandbox backend (no new spawn lib). */
export const defaultExec: Exec = async (command, cwd, timeoutMs) => {
  const backend = sandboxRegistry().get('local');
  if (!backend) return { success: false, stdout: '', stderr: 'no local backend' };
  const r = await backend.run({ command, cwd, timeoutMs });
  return { success: r.success, stdout: r.stdout, stderr: r.stderr };
};

// ── KernelHost real (fs + tools + approval) ──────────────────────────────────────

export interface FsHostOptions {
  root: string;                                                  // jaula de ficheros (todo ref es relativo a root)
  invokeTool?: (tool: string, args: unknown) => Promise<unknown>; // dispatcher real de tools (inyectado)
  asker?: Asker;                                                 // UI de aprobación (inyectada)
  log?: (e: SkillEvent) => void;
}

/** Resolve a ref under root, refusing path traversal outside the cage. */
function safeJoin(root: string, ref: string): string {
  const p = path.resolve(root, ref);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error(`kaname: ref fuera de la jaula: ${ref}`);
  return p;
}

/** The real host the mediator delegates to once a syscall is allowed by the contract. */
export function makeFsKernelHost(opts: FsHostOptions): KernelHost {
  const root = path.resolve(opts.root);
  fs.mkdirSync(root, { recursive: true });
  return {
    async readInput(ref: string): Promise<Artifact> {
      return { ref, data: fs.readFileSync(safeJoin(root, ref), 'utf-8') };
    },
    async writeOutput(ref: string, data: Artifact): Promise<void> {
      const p = safeJoin(root, ref);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, typeof data.data === 'string' ? data.data : JSON.stringify(data.data), 'utf-8');
    },
    async invokeTool(tool: string, args: unknown): Promise<unknown> {
      if (!opts.invokeTool) throw new Error(`kaname: sin dispatcher de tools para "${tool}" (inyecta invokeTool)`);
      return opts.invokeTool(tool, args);
    },
    async requestApproval(action: ProtectedAction): Promise<boolean> {
      // delega en el approval gate real; lo no-read-only pide confirmación explícita.
      return requestApproval({ toolName: action.tool, args: action.args, destructive: effectRank(action.effect) > 1 || !isReadOnly(action.tool), reason: `efecto ${action.effect}` });
    },
    log(e: SkillEvent): void { (opts.log ?? ((x) => console.log(`[kaname:skill] ${x.skill_id} ${x.kind}${x.detail ? ' · ' + x.detail : ''}`)))(e); },
  };
}

// ── git worktrees: workspaces disjuntos por worker ───────────────────────────────

export async function createWorktree(repoRoot: string, name: string, exec: Exec = defaultExec, timeoutMs = 60_000): Promise<string> {
  const wt = path.join(repoRoot, '.kaname_worktrees', name);
  await exec(`git worktree add --detach "${wt}"`, repoRoot, timeoutMs);
  return wt;
}
export async function removeWorktree(repoRoot: string, wt: string, exec: Exec = defaultExec, timeoutMs = 60_000): Promise<void> {
  await exec(`git worktree remove "${wt}" --force`, repoRoot, timeoutMs);
}

// ── LaunchClaude real (subproceso Claude Code + writes por git + backoff) ─────────

const RATE_LIMIT = /rate.?limit|\b429\b|overloaded|usage limit|quota exceeded/i;

/** Parse `git status --porcelain` into the list of written repo-relative paths. */
export function parseGitWrites(porcelain: string): string[] {
  return porcelain.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).map((l) => {
    const body = l.replace(/^[ MADRCU?!]{1,2}\s+/, '');
    const renamed = body.split(' -> ');
    return (renamed[1] ?? body).trim();
  });
}

export interface LauncherOptions {
  exec?: Exec;
  claudeBin?: string;                       // default: "claude"
  timeoutMs?: number;
  maxRetries?: number;                      // reintentos ante rate limit (§7.3)
  sleep?: (ms: number) => Promise<void>;    // inyectable (tests → no-op)
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build the live launcher: run Claude Code (print mode) in the worker's workspace,
 * detect what it wrote via git, with bounded backoff on plan rate limits. The
 * integration (orchestrateSwarm) is what blocks any core-path write afterwards.
 */
export function makeClaudeLauncher(opts: LauncherOptions = {}): LaunchClaude {
  const exec = opts.exec ?? defaultExec;
  const bin = opts.claudeBin ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? realSleep;

  return async (worker: SwarmWorker, prompt: string): Promise<WorkerResult> => {
    const cwd = worker.workspace;
    const cmd = `${bin} -p ${JSON.stringify(prompt)}`;
    let run = await exec(cmd, cwd, timeoutMs);
    for (let attempt = 1; attempt <= maxRetries && !run.success && RATE_LIMIT.test(run.stderr + run.stdout); attempt++) {
      await sleep(Math.min(60_000, 1000 * 2 ** attempt));   // backoff exponencial, cap 60s
      run = await exec(cmd, cwd, timeoutMs);
    }
    const status = await exec('git status --porcelain', cwd, 30_000);
    return {
      worker_id: worker.worker_id, front: worker.assigned_front,
      writes: status.success ? parseGitWrites(status.stdout) : [],
      raw_output: run.stdout || run.stderr,
      ok: run.success,
    };
  };
}
