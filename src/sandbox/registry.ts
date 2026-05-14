/**
 * Sandbox registry — singleton que mantiene la lista de backends de
 * ejecución de comandos disponibles (local, docker, ssh, modal, daytona,
 * e2b, mock).
 *
 * Selección por defecto:
 *   1. `SHINOBI_RUN_BACKEND` env (id explícito).
 *   2. Si no se especifica, devuelve `local`.
 *
 * Política: si el usuario pide un backend que NO está configurado, el
 * registry lo respeta y deja al backend devolver su mensaje de error
 * (eso ya cuenta como log claro). NO hace fallback silencioso a `local`
 * porque eso enmascara fallos de configuración y rompe la promesa de
 * isolación cuando el operador quiere VPS aislado.
 */

import type { BackendId, RunBackend, BackendStatus } from './types.js';
import { LocalBackend } from './backends/local.js';
import { DockerBackend } from './backends/docker.js';
import { SSHBackend } from './backends/ssh.js';
import { ModalBackend } from './backends/modal.js';
import { DaytonaBackend } from './backends/daytona.js';
import { E2BBackend } from './backends/e2b.js';
import { MockBackend } from './backends/mock.js';

class SandboxRegistry {
  private readonly backends = new Map<BackendId, RunBackend>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register(new LocalBackend());
    this.register(new DockerBackend());
    this.register(new SSHBackend());
    this.register(new ModalBackend());
    this.register(new DaytonaBackend());
    this.register(new E2BBackend());
    // Mock NO se registra por default — lo añaden los tests con `register()`.
  }

  register(backend: RunBackend): void {
    this.backends.set(backend.id, backend);
  }

  get(id: BackendId): RunBackend | undefined {
    return this.backends.get(id);
  }

  list(): RunBackend[] {
    return [...this.backends.values()];
  }

  reset(): void {
    this.backends.clear();
    this.registerDefaults();
  }

  /** Backend a usar según env. */
  resolveDefault(): RunBackend {
    const want = (process.env.SHINOBI_RUN_BACKEND || 'local').toLowerCase() as BackendId;
    const b = this.backends.get(want);
    if (b) return b;
    // El env apunta a un id desconocido — degradamos a local con warning.
    console.warn(`[sandbox] SHINOBI_RUN_BACKEND='${want}' no reconocido; usando local.`);
    return this.backends.get('local')!;
  }

  summary(): BackendStatus[] {
    return this.list().map(b => ({
      id: b.id,
      label: b.label,
      configured: b.isConfigured(),
      requires: b.requiredEnvVars(),
    }));
  }
}

let _instance: SandboxRegistry | null = null;

export function sandboxRegistry(): SandboxRegistry {
  if (!_instance) _instance = new SandboxRegistry();
  return _instance;
}

export function _resetSandboxRegistry(): void {
  _instance = null;
}

export { MockBackend };
