/**
 * shugyo/sandbox/revertible.ts — the revertible cage (dossier §7.2). THE safety
 * core: every exploration action runs from a clean known state and, after
 * observing, is reverted. Exploration isn't "careful" — it's "break whatever in
 * here, I'll blow the cage and start over". That's what makes exploring safe.
 *
 * Design: the REVERT mechanism is a working-directory snapshot (fs.cpSync copy +
 * wipe/restore, content-addressed by a SHA-256 hash of the tracked files in
 * `state()`) — the lightest option in §7.2, the one whose gate we can meet by
 * execution. The EXECUTION of an action is delegated to the existing sandbox
 * RunBackend (reuse, not a new isolation) — `defaultExecutor` below goes through
 * the P1 reference monitor (`mediatedEffect`, default backend `local`), i.e.
 * plain `child_process.exec` with NO OS-level
 * confinement (no container, no VM, no namespace). So TODAY: isolation = directory
 * snapshot/restore only; the command itself runs with full host privileges while
 * it's executing — the cage only guarantees the FILESYSTEM STATE is restored
 * afterward, not that the command was contained while it ran. `isolation strength
 * is pluggable` refers to swapping which RunBackend is injected here (e.g. the
 * hardened docker.ts backend from F2.2) — that swap is NOT wired up by default
 * today. The executionPolicy gate (external_effect never fires) is enforced here.
 * Contract: after ANY action, revert() leaves the world as it was — that contract
 * is about filesystem state, not about the command's OS-level blast radius while
 * it was running.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { mediatedEffect } from '../../sandbox/monitor.js';
import { executionPolicy } from '../explore/reversibility.js';
import type { Affordance, ActionTrial, StateSnapshot } from '../types.js';

/** Run a command in a working dir → success/stdout. Pluggable (local/docker/e2b). */
export type CageExecutor = (command: string, cwd: string, timeoutMs: number) => Promise<{ success: boolean; stdout: string; stderr: string }>;

/**
 * Default executor: P1.E2 (plan de frontera) — la acción de exploración corre a
 * través del Monitor de Referencia (backend local por defecto), no del registry
 * directo. `reversible: true` es la declaración HONESTA del caller: la jaula
 * garantiza snapshot/restore del directorio de trabajo tras cada acción (ese es
 * su contrato), no confinamiento del proceso mientras corre.
 */
const defaultExecutor: CageExecutor = async (command, cwd, timeoutMs) => {
  const res = await mediatedEffect({
    kind: 'shell',
    rawCommandLine: true,
    target: command,
    cwd,
    timeoutMs,
    reversible: true,
  });
  if (!res.ok) return { success: false, stdout: '', stderr: 'no local backend' };
  return { success: res.run.success, stdout: res.run.stdout, stderr: res.run.stderr };
};

export interface RevertibleSandbox {
  snapshot(): Promise<string>;
  revert(snapshotId: string): Promise<void>;
  runAction(a: Affordance, args?: Record<string, unknown>): Promise<{ before: StateSnapshot; after: StateSnapshot; executed: boolean; output: string }>;
  dispose(): Promise<void>;
}

export interface CageOptions { root?: string; executor?: CageExecutor; timeoutMs?: number; }

export class DirCageSandbox implements RevertibleSandbox {
  readonly workDir: string;
  private snapDir: string;
  private exec: CageExecutor;
  private timeoutMs: number;
  private snapSeq = 0;

  constructor(opts: CageOptions = {}) {
    const base = opts.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'shugyo_cage_'));
    this.workDir = path.join(base, 'work');
    this.snapDir = path.join(base, 'snapshots');
    fs.mkdirSync(this.workDir, { recursive: true });
    fs.mkdirSync(this.snapDir, { recursive: true });
    this.exec = opts.executor ?? defaultExecutor;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Seed a file into the cage (filler / fixtures for exploration). */
  seed(relPath: string, content: string): void {
    const p = path.join(this.workDir, relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
  }

  async snapshot(): Promise<string> {
    const id = `snap_${++this.snapSeq}`;
    const dest = path.join(this.snapDir, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(this.workDir, dest, { recursive: true });
    return id;
  }

  async revert(snapshotId: string): Promise<void> {
    const src = path.join(this.snapDir, snapshotId);
    if (!fs.existsSync(src)) throw new Error(`cage: snapshot ${snapshotId} not found`);
    // wipe the work dir, then restore the snapshot — complete restoration.
    fs.rmSync(this.workDir, { recursive: true, force: true });
    fs.mkdirSync(this.workDir, { recursive: true });
    fs.cpSync(src, this.workDir, { recursive: true });
  }

  /** Content-addressed state of the cage (sorted file list + per-file hash). */
  state(): StateSnapshot {
    const files: string[] = [];
    const walk = (d: string, rel: string) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = path.join(d, ent.name); const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(abs, r);
        else { const h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 12); files.push(`${r}:${h}`); }
      }
    };
    walk(this.workDir, '');
    const ref = `sha256:${crypto.createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16)}`;
    return { ref, summary: `${files.length} files` };
  }

  /**
   * Run an affordance under its execution policy. external_effect → DOCUMENTED,
   * NEVER fired. destructive/unknown → executed (cage is filler-only + revertible).
   * reversible → executed. Returns before/after state for effect inference.
   */
  async runAction(a: Affordance, args: Record<string, unknown> = {}): Promise<{ before: StateSnapshot; after: StateSnapshot; executed: boolean; output: string }> {
    const before = this.state();
    const policy = executionPolicy(a.reversibility);
    if (policy === 'document_only') {
      return { before, after: before, executed: false, output: `external_effect documented, NOT fired: ${a.label}` };
    }
    const command = buildCommand(a, args);
    const r = await this.exec(command, this.workDir, this.timeoutMs);
    const after = this.state();
    return { before, after, executed: true, output: r.success ? r.stdout : `error: ${r.stderr}` };
  }

  async dispose(): Promise<void> {
    const base = path.dirname(this.workDir);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function buildCommand(a: Affordance, args: Record<string, unknown>): string {
  const argStr = Object.entries(args).map(([k, v]) => `${k}=${v}`).join(' ');
  return `${a.signature ?? a.label}${argStr ? ' ' + argStr : ''}`;
}

/**
 * Run a full exploration trial: snapshot → runAction → build ActionTrial →
 * revert. The cage is ALWAYS left reverted (invariant). external_effect actions
 * produce a trial that records "not fired" and changes nothing.
 */
export async function runTrial(cage: DirCageSandbox, a: Affordance, args: Record<string, unknown> = {}): Promise<ActionTrial> {
  const snap = await cage.snapshot();
  const { before, after, executed, output } = await cage.runAction(a, args);
  const changed = before.ref !== after.ref;
  const trial: ActionTrial = {
    trial_id: `trial_${a.affordance_id}_${snap}`,
    affordance_id: a.affordance_id,
    args,
    state_before: before,
    state_after: after,
    observed_effect: executed ? (changed ? `state changed: ${before.summary} → ${after.summary}` : 'no observable state change') : output,
    success: executed && (changed || /ok|done|success/i.test(output)),
    on_revertible_sandbox: true,
  };
  await cage.revert(snap);   // invariant: cage left as it was
  return trial;
}
