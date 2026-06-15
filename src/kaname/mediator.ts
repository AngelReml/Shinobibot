/**
 * kaname/mediator.ts — KN-03: mediación total (§6.2/§6.3). El núcleo envuelve la
 * superficie estrecha: cada syscall de una skill se valida contra su manifiesto
 * ANTES de delegar al host real. Una tool no declarada, un efecto por encima del
 * declarado, o una ref fuera de scope → DENEGADO en runtime (no por buena voluntad
 * de la skill). Reutiliza la Capa 2 (classifyEffect/effectWithin). Es lo que hace
 * que "aislamiento" sea una propiedad enforced, no una esperanza.
 */

import { classifyEffect, effectWithin } from '../integrity/effects.js';
import type { KernelSyscalls, SkillManifestLite, Artifact, ProtectedAction, SkillEvent } from './types.js';

/** The real kernel operations the mediator delegates to once a call is allowed. */
export interface KernelHost {
  readInput(ref: string): Promise<Artifact>;
  writeOutput(ref: string, data: Artifact): Promise<void>;
  invokeTool(tool: string, args: unknown): Promise<unknown>;
  requestApproval(action: ProtectedAction): Promise<boolean>;
  log(event: SkillEvent): void;
}

export class SyscallDenied extends Error {
  constructor(public readonly skill_id: string, public readonly op: string, reason: string) {
    super(`kaname: DENEGADO [${skill_id}] ${op} — ${reason}`);
    this.name = 'SyscallDenied';
  }
}

function scoped(refs: string[] | undefined, ref: string): boolean {
  return !refs || refs.length === 0 ? true : refs.includes(ref);   // no scope declared = unrestricted within zone
}

/** Build the mediated syscalls for a skill: enforce its contract, then delegate. */
export function makeMediator(manifest: SkillManifestLite, host: KernelHost): KernelSyscalls {
  const id = manifest.skill_id;
  return {
    async readInput(ref) {
      if (!scoped(manifest.reads, ref)) throw new SyscallDenied(id, 'readInput', `ref "${ref}" fuera del scope de lectura declarado`);
      return host.readInput(ref);
    },
    async writeOutput(ref, data) {
      if (!effectWithin('write', manifest.declared_effects)) throw new SyscallDenied(id, 'writeOutput', `escribir excede declared_effects "${manifest.declared_effects}"`);
      if (!scoped(manifest.writes, ref)) throw new SyscallDenied(id, 'writeOutput', `ref "${ref}" fuera del scope de escritura declarado`);
      return host.writeOutput(ref, data);
    },
    async invokeTool(tool, args) {
      if (!manifest.declared_tools.includes(tool)) throw new SyscallDenied(id, 'invokeTool', `tool "${tool}" no declarada [${manifest.declared_tools.join(', ') || '∅'}]`);
      const eff = classifyEffect(tool);
      if (!effectWithin(eff, manifest.declared_effects)) throw new SyscallDenied(id, 'invokeTool', `efecto de "${tool}" (${eff}) excede declared_effects "${manifest.declared_effects}"`);
      return host.invokeTool(tool, args);
    },
    requestApproval(action) { return host.requestApproval(action); },
    log(event) { host.log({ ...event, skill_id: id }); },
  };
}
