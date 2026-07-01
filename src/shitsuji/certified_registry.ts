/**
 * shitsuji/certified_registry.ts — F3.3: re-verificación CRIPTOGRÁFICA de
 * "certified" al ejecutar, no solo membresía de nombre.
 *
 * Problema que cierra: `feasibility.ts` (checkFeasibility) decide si un
 * plan es factible comprobando `certifiedRepertoire().has(step.skill_id)` —
 * membresía de un Set de STRINGS. Eso confirma que Kangeiko tiene *algún*
 * skill_id con ese nombre en estado 'active', pero NO confirma que el
 * código que se va a ejecutar sea REALMENTE el que Shugyō certificó bajo
 * ese id — un skill_id es solo una clave de texto; nada impide que el
 * artefacto detrás de ese nombre cambie entre la certificación y la
 * ejecución (bug de wiring, colisión de nombre, tampering del comando
 * renderizado, etc.).
 *
 * Shugyō SÍ calcula un checksum real en el momento de certificar
 * (`shugyo/synth/certify.ts::SkillManifest.artifact_hash`, sha256 del
 * comando + procedimiento exacto certificado) — pero ese hash no viaja con
 * el `RepertoireEntry` que Kangeiko persiste (kk_repertoire no tiene
 * columna de hash; fuera de este alcance para modificar). Esta capa cierra
 * el hueco DENTRO de shitsuji: un `CertifiedRegistry` inyectable que
 * asocia skill_id → hash esperado, y una comprobación que se ejecuta ANTES
 * de invocar la skill. Si el hash del artefacto que se va a ejecutar
 * (`actualHash(step)`, inyectado — típicamente sha256 del `step.inputs.command`
 * u otro artefacto declarado) no coincide con el esperado, el step se
 * rechaza ANTES de llegar a la jaula/invoke — nunca se ejecuta código cuyo
 * checksum no está certificado.
 *
 * IMPORTANTE — esto es una capa ADICIONAL, no un reemplazo:
 *   - Capa 1 (feasibility.ts): ¿el nombre está en el repertorio activo?
 *   - Capa 2 (runtime.ts existente): ejecución sobre copias en jaula,
 *     external_effect nunca disparado, efecto observado ⊆ declarado
 *     (11.2/11.4) — INTACTA, no se toca ni se debilita aquí.
 *   - Capa 3 (ESTE módulo, NUEVO): el checksum del artefacto que se va a
 *     ejecutar coincide con el certificado, no solo su nombre.
 *
 * Si no se provee un registry (uso por defecto, retro-compatible), esta
 * capa es un no-op — los callers existentes no se rompen. Para activarla,
 * un caller pasa `certified: { registry, actualHash }` a `makeRealExecutor`.
 */

import * as crypto from 'node:crypto';
import type { PlanStep } from './types.js';

export interface CertifiedEntry {
  skill_id: string;
  /** sha256 hex (o con prefijo 'sha256:') del artefacto certificado — típicamente
   *  Shugyō's SkillManifest.artifact_hash, o el checksum de skill_signing.ts. */
  artifact_hash: string;
}

export type CertifiedRegistry = Map<string, string>; // skill_id → expected artifact_hash

export function buildCertifiedRegistry(entries: CertifiedEntry[]): CertifiedRegistry {
  const m: CertifiedRegistry = new Map();
  for (const e of entries) m.set(e.skill_id, normalizeHash(e.artifact_hash));
  return m;
}

function normalizeHash(h: string): string {
  return h.startsWith('sha256:') ? h.slice('sha256:'.length) : h;
}

/** Hash por defecto de un step: sha256 del comando renderizado (inputs.command),
 *  que es el artefacto ejecutable real — mismo material que Shugyō hashea en
 *  SkillManifest.artifact_hash cuando el step viene de un comando CLI certificado.
 *  Un caller puede inyectar un `actualHash` distinto si su noción de "artefacto"
 *  es otra (p.ej. un script completo en vez de solo el comando). */
export function defaultStepArtifactHash(step: PlanStep): string | undefined {
  const command = (step.inputs as any)?.command;
  if (typeof command !== 'string' || command.length === 0) return undefined;
  return crypto.createHash('sha256').update(command).digest('hex');
}

export interface CertifiedCheckDeps {
  registry: CertifiedRegistry;
  /** Calcula el hash del artefacto que REALMENTE se va a ejecutar para este
   *  step. Default: defaultStepArtifactHash (hash del comando renderizado). */
  actualHash?: (step: PlanStep) => string | undefined;
}

export interface CertifiedCheckResult {
  ok: boolean;
  reason?: 'not_in_registry' | 'no_artifact' | 'hash_mismatch';
  expectedHash?: string;
  actualHash?: string;
}

/**
 * Re-verifica criptográficamente que el step a ejecutar es EXACTAMENTE el
 * artefacto certificado bajo su skill_id — no solo que el nombre coincide.
 *
 *   - Si el skill_id no está en el registry: 'not_in_registry' — no es un
 *     rechazo de por sí (el registry puede ser parcial/opt-in; el caller
 *     decide si tratarlo como fail-closed o dejarlo pasar a la Capa 2).
 *   - Si está en el registry pero no se puede calcular el hash actual (p.ej.
 *     el step no trae `inputs.command`): 'no_artifact'.
 *   - Si el hash calculado no coincide con el esperado: 'hash_mismatch' —
 *     el nombre es certified pero el artefacto NO es el que se certificó.
 */
export function verifyCertifiedChecksum(step: PlanStep, deps: CertifiedCheckDeps): CertifiedCheckResult {
  if (!step.skill_id) return { ok: true }; // dojo capability, no aplica
  const expected = deps.registry.get(step.skill_id);
  if (expected === undefined) return { ok: false, reason: 'not_in_registry' };

  const computeHash = deps.actualHash ?? defaultStepArtifactHash;
  const actual = computeHash(step);
  if (!actual) return { ok: false, reason: 'no_artifact', expectedHash: expected };

  const normalizedActual = normalizeHash(actual);
  if (normalizedActual !== expected) {
    return { ok: false, reason: 'hash_mismatch', expectedHash: expected, actualHash: normalizedActual };
  }
  return { ok: true, expectedHash: expected, actualHash: normalizedActual };
}
