/**
 * BrowserSandboxManager — wraps docker compose + healthcheck para el
 * Sandbox Browser pre-baked (Sprint P1.3, paridad arquitectónica con
 * OpenClaw sandbox-browser).
 *
 * Filosofía:
 *   - No instala Docker — fail-fast si no está.
 *   - Sólo opera con el compose file fijo `docker-compose.sandbox-browser.yml`
 *     en la raíz del repo. No corre docker run ad-hoc.
 *   - Métodos puros: `up()`, `down()`, `status()`, `cdpUrl()`, `vncUrl()`,
 *     `healthCheck()`.
 *   - `healthCheck` usa fetchImpl inyectable (mismo patrón que `remote_mode.ts`).
 *
 * El sandbox SIEMPRE bindea 127.0.0.1. No expone puertos a internet.
 */

import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

export type FetchLike = (
  url: string,
  init?: { method?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text?: () => Promise<string> }>;

export interface ManagerOptions {
  /** Path al docker-compose.sandbox-browser.yml. */
  composePath?: string;
  /** Comando docker (inyectable para tests). */
  dockerBin?: string;
  /** Spawn override para tests (devuelve ChildProcess mock). */
  spawnImpl?: typeof spawn;
  /** Fetch override para healthCheck en tests. */
  fetchImpl?: FetchLike;
  /** Override de puertos (default 6080/9222). */
  novncPort?: number;
  cdpPort?: number;
}

export interface ComposeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HealthResult {
  ok: boolean;
  novncOk: boolean;
  cdpOk: boolean;
  errors: string[];
}

export class BrowserSandboxManager {
  private composePath: string;
  private dockerBin: string;
  private spawnImpl: typeof spawn;
  private fetchImpl: FetchLike;
  private novncPort: number;
  private cdpPort: number;

  constructor(opts: ManagerOptions = {}) {
    this.composePath = opts.composePath
      ?? resolve(process.cwd(), 'docker-compose.sandbox-browser.yml');
    this.dockerBin = opts.dockerBin ?? 'docker';
    this.spawnImpl = opts.spawnImpl ?? spawn;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.novncPort = opts.novncPort ?? 6080;
    this.cdpPort = opts.cdpPort ?? 9222;
  }

  /** URL noVNC (UI web del browser). */
  vncUrl(): string {
    return `http://127.0.0.1:${this.novncPort}/vnc.html`;
  }

  /** URL CDP (Chrome DevTools Protocol). */
  cdpUrl(): string {
    return `http://127.0.0.1:${this.cdpPort}`;
  }

  /** Verifica que el compose file existe. */
  isComposeAvailable(): boolean {
    return existsSync(this.composePath);
  }

  /** Arranca el sandbox via `docker compose up -d --build`. */
  async up(opts: { build?: boolean } = {}): Promise<ComposeRunResult> {
    this.requireCompose();
    const args = ['compose', '-f', this.composePath, 'up', '-d'];
    if (opts.build) args.push('--build');
    return this.runDocker(args);
  }

  /** Baja el sandbox via `docker compose down`. */
  async down(): Promise<ComposeRunResult> {
    this.requireCompose();
    return this.runDocker(['compose', '-f', this.composePath, 'down']);
  }

  /** Estado del container via `docker compose ps`. */
  async status(): Promise<ComposeRunResult> {
    this.requireCompose();
    return this.runDocker(['compose', '-f', this.composePath, 'ps']);
  }

  /** Healthcheck HTTP de novnc + CDP. Usa fetchImpl inyectable. */
  async healthCheck(opts: { timeoutMs?: number } = {}): Promise<HealthResult> {
    const errors: string[] = [];
    const probe = async (url: string): Promise<boolean> => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
      try {
        const r = await this.fetchImpl(url, { signal: ctrl.signal });
        return r.ok;
      } catch (e: any) {
        errors.push(`${url} → ${e?.message ?? e}`);
        return false;
      } finally {
        clearTimeout(to);
      }
    };
    const novncOk = await probe(this.vncUrl());
    const cdpOk = await probe(`${this.cdpUrl()}/json/version`);
    return { ok: novncOk && cdpOk, novncOk, cdpOk, errors };
  }

  private requireCompose(): void {
    if (!this.isComposeAvailable()) {
      throw new Error(`docker-compose.sandbox-browser.yml no encontrado en ${this.composePath}`);
    }
  }

  private runDocker(args: string[]): Promise<ComposeRunResult> {
    return new Promise((resolveP, rejectP) => {
      let stdout = '';
      let stderr = '';
      let child: ChildProcess;
      try {
        child = this.spawnImpl(this.dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        rejectP(e);
        return;
      }
      child.stdout?.on('data', (c) => { stdout += c.toString('utf-8'); });
      child.stderr?.on('data', (c) => { stderr += c.toString('utf-8'); });
      child.on('error', (e) => rejectP(e));
      child.on('exit', (code) => {
        resolveP({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}
