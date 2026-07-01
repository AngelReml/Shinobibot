/**
 * kaname/types.ts — modelo de datos del núcleo (§12). Tipos puros. El núcleo es
 * mínimo y versionado; las skills viven en userspace con procedencia; el enjambre
 * trabaja en frentes disjuntos. La superficie estrecha (KernelSyscalls) es la ÚNICA
 * vía por la que una skill pide al núcleo.
 */

import type { Effect } from '../integrity/effects.js';

// ── §6.2 La API estrecha (las "llamadas al sistema") ────────────────────────────
export interface Artifact { ref: string; data: unknown; }
export interface ProtectedAction { tool: string; args: unknown; effect: Effect; }
export interface SkillEvent { skill_id: string; kind: string; detail?: string }

/** La superficie mínima y única que el núcleo expone a una skill. Nada más. */
export interface KernelSyscalls {
  readInput(ref: string): Promise<Artifact>;
  writeOutput(ref: string, data: Artifact): Promise<void>;
  invokeTool(tool: string, args: unknown): Promise<unknown>;
  requestApproval(action: ProtectedAction): Promise<boolean>;
  log(event: SkillEvent): void;
}

// ── §6.1 Declaración (⚠ ENGANCHE Sello §10) ─────────────────────────────────────
export interface SkillManifestLite {
  skill_id: string;
  declared_tools: string[];           // qué syscalls/tools puede invocar
  declared_effects: Effect;           // techo de efecto
  reads?: string[];                   // refs de entrada permitidas (read scope)
  writes?: string[];                  // refs de salida permitidas (write scope)
}

// ── §12 Modelo de datos ─────────────────────────────────────────────────────────
export interface KernelVersion {
  version: string;                    // "1.0", "1.1"
  hash: string;                       // hash del núcleo
  promoted_at: string;
  dojo_hard_tests: 'green' | 'red';
  suite: { passed: number; skipped: number };
  /** Ruta absoluta al snapshot del directorio kernel creado en la promoción. */
  snapshot_path?: string;
}

export interface SkillRecord {
  skill_id: string;
  csv_ref: string;                    // certificación Sello
  manifest_ref: string;               // declared_tools, declared_effects, I/O
  status: 'loaded' | 'isolated' | 'rejected';
  created_by: 'swarm' | 'manual';     // procedencia (regla de Hermes)
  // HONESTIDAD (F2.13, auditoría 2026-07): 'sandboxed' es una etiqueta de
  // PROCEDENCIA/POLÍTICA (la skill pasó por el mediador de mediator.ts, que
  // valida cada syscall contra su manifiesto ANTES de delegar), NO una
  // garantía de aislamiento de sistema operativo. Es el único valor posible
  // hoy porque toda skill cargada por kaname pasa por el mediador — no
  // implica namespace/container/VM/chroot. Ver banner de mediator.ts.
  isolation: 'sandboxed';
}

export interface SwarmWorker {
  worker_id: string;
  role: 'builder' | 'verifier';
  assigned_front: string;             // frente disjunto
  workspace: string;                  // worktree/rama/sandbox propio
  status: 'running' | 'done' | 'failed';
  raw_output_ref?: string;            // salida cruda (verificadores)
}
