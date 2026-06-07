// src/agents/worktree.ts
//
// AISLAMIENTO POR WORKTREES (pieza-motor del cimiento, base de E4).
//
// Un git worktree es un checkout enlazado e independiente del mismo repo, en su
// propia rama. Permite que un (sub)agente que MUTA ficheros trabaje en una copia
// aislada sin pisar el árbol principal ni a otros agentes; al terminar, los
// cambios se conservan (rama propia) o se descartan, y el worktree se limpia si
// quedó intacto (igual que hacen los agentes de primera línea).
//
// IMPORTANTE — modelo de cwd de shinobi: las tools resuelven paths con
// `process.cwd()` y la frontera de seguridad es `WORKSPACE_ROOT || cwd` (ver
// utils/permissions.ts). Ese cwd es GLOBAL al proceso. Por eso `withWorktree`
// (abajo) aísla de forma SECUENCIAL (save/restore de cwd + WORKSPACE_ROOT): un
// agente a la vez dentro de su worktree. El aislamiento PARALELO real exige cwd
// por-llamada (refactor futuro, cuando se construya la orquestación Team).
//
// El runner de git es inyectable: los unit-tests ejercitan el parseo/args sin
// git, y un test de integración usa git REAL sobre un repo temporal.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Worktree {
  /** Ruta absoluta del worktree (checkout aislado). */
  path: string;
  /** Rama creada para este worktree. */
  branch: string;
  /** SHA del HEAD (cuando se obtiene de `list`). */
  head?: string;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Ejecuta git y devuelve código + salidas (NO lanza en código ≠ 0). */
export type GitRunner = (args: string[], opts?: { cwd?: string }) => GitResult;

const defaultGit: GitRunner = (args, opts) => {
  const r = spawnSync('git', args, { cwd: opts?.cwd, encoding: 'utf-8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

export interface WorktreeManagerOptions {
  /** Raíz del repo (default cwd). */
  repoRoot?: string;
  /** Dir donde viven los worktrees (default <tmp>/shinobi-worktrees). */
  baseDir?: string;
  /** Runner de git (inyectable para test). */
  git?: GitRunner;
}

/** Sanitiza una etiqueta para usarla como nombre de rama/carpeta. */
function sanitize(label: string): string {
  return (label || 'wt')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'wt';
}

let _counter = 0;

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly baseDir: string;
  private readonly git: GitRunner;

  constructor(opts: WorktreeManagerOptions = {}) {
    this.repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
    this.baseDir = path.resolve(opts.baseDir ?? path.join(os.tmpdir(), 'shinobi-worktrees'));
    this.git = opts.git ?? defaultGit;
  }

  /** True si el repoRoot es un repositorio git válido. */
  isGitRepo(): boolean {
    const r = this.git(['rev-parse', '--is-inside-work-tree'], { cwd: this.repoRoot });
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  /**
   * Crea un worktree aislado en una rama nueva desde HEAD. Lanza si git falla
   * (no se puede aislar a medias). El nombre de rama es único por proceso.
   */
  create(label: string): Worktree {
    const branch = `shinobi-wt-${sanitize(label)}-${process.pid}-${++_counter}`;
    const wtPath = path.join(this.baseDir, branch);
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });

    const r = this.git(['worktree', 'add', '-b', branch, wtPath, 'HEAD'], { cwd: this.repoRoot });
    if (r.code !== 0) {
      throw new Error(`No se pudo crear el worktree (${branch}): ${r.stderr.trim() || r.stdout.trim() || 'git falló'}`);
    }
    return { path: wtPath, branch };
  }

  /** Lista los worktrees del repo (parseo de `git worktree list --porcelain`). */
  list(): Worktree[] {
    const r = this.git(['worktree', 'list', '--porcelain'], { cwd: this.repoRoot });
    if (r.code !== 0) return [];
    return parseWorktreeList(r.stdout);
  }

  /** True si el worktree no tiene cambios (working tree limpio, sin untracked). */
  isClean(wtPath: string): boolean {
    const r = this.git(['status', '--porcelain'], { cwd: wtPath });
    return r.code === 0 && r.stdout.trim() === '';
  }

  /** Elimina un worktree. `force` descarta cambios locales. */
  remove(wtPath: string, force = false): boolean {
    const args = ['worktree', 'remove', wtPath, ...(force ? ['--force'] : [])];
    const r = this.git(args, { cwd: this.repoRoot });
    return r.code === 0;
  }

  /**
   * Elimina el worktree SOLO si quedó intacto (auto-limpieza). Si tiene
   * cambios, lo conserva para que el caller decida (merge / inspección).
   */
  removeIfUnchanged(wtPath: string): { removed: boolean; reason: string } {
    if (!this.isClean(wtPath)) return { removed: false, reason: 'dirty' };
    return { removed: this.remove(wtPath, false), reason: 'clean' };
  }

  /** Poda referencias a worktrees ya borrados del disco. */
  prune(): void {
    this.git(['worktree', 'prune'], { cwd: this.repoRoot });
  }
}

/** Parsea la salida de `git worktree list --porcelain` en bloques. */
export function parseWorktreeList(stdout: string): Worktree[] {
  const out: Worktree[] = [];
  let cur: Partial<Worktree> = {};
  const flush = () => {
    if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? '(detached)', head: cur.head });
    cur = {};
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      flush();
      cur.path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line.trim() === 'detached') {
      cur.branch = '(detached)';
    }
  }
  flush();
  return out;
}

/**
 * Ejecuta `fn` con cwd + WORKSPACE_ROOT scoped a un worktree fresco, y limpia
 * después. SECUENCIAL por diseño (cwd global): no envolver dos llamadas
 * concurrentes. Por defecto descarta el worktree (force); con `keepIfChanged`
 * lo conserva si quedó con cambios.
 */
export async function withWorktree<T>(
  mgr: WorktreeManager,
  label: string,
  fn: (wt: Worktree) => Promise<T>,
  opts: { keepIfChanged?: boolean } = {},
): Promise<{ result: T; worktree: Worktree; kept: boolean }> {
  const wt = mgr.create(label);
  const prevCwd = process.cwd();
  const prevWsRoot = process.env.WORKSPACE_ROOT;
  process.chdir(wt.path);
  process.env.WORKSPACE_ROOT = wt.path;

  let result: T;
  try {
    result = await fn(wt);
  } finally {
    // Restaurar SIEMPRE el entorno global antes de tocar nada más.
    process.chdir(prevCwd);
    if (prevWsRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = prevWsRoot;
  }

  // Limpieza tras restaurar el entorno (solo en éxito; si fn lanzó, la
  // excepción ya se propagó y el worktree queda para inspección).
  let kept: boolean;
  if (opts.keepIfChanged) {
    kept = !mgr.removeIfUnchanged(wt.path).removed;
  } else {
    mgr.remove(wt.path, true);
    kept = false;
  }
  return { result, worktree: wt, kept };
}
