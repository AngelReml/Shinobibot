/**
 * shitsuji/runtime.ts — T-08: REAL execution under Capa 2, on copies/snapshots,
 * with transfer between steps (⚑ MUNDO-REAL). This is the live `runStep`/`revert`
 * that the deterministic runPlan() (execute.ts) drives. It is the seam where the
 * butler stops reasoning and touches the world — so it wears the full armor:
 *
 *   0. CAPA 3 (F3.3, NUEVA) — CERTIFIED POR CHECKSUM, NO SOLO POR NOMBRE. Antes
 *      de tocar la jaula, si el caller inyectó un `certified` registry
 *      (certified_registry.ts), el step se re-verifica: el hash del artefacto
 *      que se va a ejecutar debe coincidir con el hash que Shugyō certificó bajo
 *      ese skill_id. `feasibility.ts` solo comprueba que el NOMBRE está en el
 *      repertorio (`Set<string>.has(skill_id)`) — eso no protege contra que el
 *      artefacto detrás de ese nombre haya cambiado. Esta capa es ADICIONAL a la
 *      1/2/3 de abajo, no las reemplaza; si no se inyecta `certified`, es un
 *      no-op retro-compatible.
 *   1. COPIAS/SNAPSHOTS — every step runs inside a revertible cage (reuse Shugyō's
 *      DirCageSandbox). The user's real inputs are COPIED in; the original is never
 *      the thing operated on. A snapshot is taken before each step so revert()
 *      restores the exact prior state.
 *   2. EFECTO EXTERNO NUNCA SE DISPARA — external_effect steps (comprar/pagar/enviar)
 *      are DOCUMENTED, never invoked. Even if approved. (the ⚑ hard line.)
 *   3. CAPA 2 — after the skill runs, the OBSERVED effect (measured from the cage
 *      state-diff + the tool used) must be ⊆ the step's declared effect (11.2), and
 *      the skill's REPORTED success must match what really happened (11.4). A skill
 *      that exceeds its effect, or reports a success that didn't occur, FAILS the
 *      step — it does not "stand".
 *   4. TRANSFERENCIA — a step's produced artifact is carried forward to downstream
 *      steps (cross-app data flow) within the same cage.
 *
 * The genuinely live pieces — invoking the certified skill, seeding real-data
 * copies, committing a reversible result back to the real world — are INJECTED
 * (SkillInvoker / copyInputs / commit). By default nothing is committed to the real
 * world (fail-safe: the work stays in the cage), so this module is fully testable
 * without live resources and safe by construction.
 */

import { DirCageSandbox } from '../shugyo/sandbox/revertible.js';
import { classifyEffect, effectWithin, effectRank, type Effect } from '../integrity/effects.js';
import { check11_4 } from '../integrity/checks.js';
import type { PlanStep, StepResult } from './types.js';
import type { ExecuteDeps } from './execute.js';
import { verifyCertifiedChecksum, type CertifiedCheckDeps } from './certified_registry.js';

/** The live skill invocation (⚑). Runs a CERTIFIED skill over the data placed in
 *  `workDir`; returns the REAL outcome. `claims_success` is what the skill/agent
 *  *reports* (for 11.4); `success` is what actually happened. */
export interface SkillInvocation {
  success: boolean;
  claims_success?: boolean;      // reported; defaults to `success` if absent
  output: string;
  artifact?: string;             // path (relative to workDir) of a produced artifact, for transfer
  claim?: string;                // a concrete value the skill asserts (11.4 token check)
  tool?: string;                 // the Shinobi tool actually used (11.2 effect classification)
}

export type SkillInvoker = (
  step: PlanStep,
  ctx: { workDir: string; upstream: Record<string, string> },
) => Promise<SkillInvocation>;

export interface RealExecDeps {
  invoke: SkillInvoker;                                              // ⚑ live: execute the certified skill
  copyInputs?: (step: PlanStep, workDir: string) => void | Promise<void>;   // ⚑ live: seed COPIES of real inputs into the cage
  commit?: (step: PlanStep, workDir: string) => void | Promise<void>;       // ⚑ live: apply a reversible result to the real world (default: no-op)
  uncommit?: (step: PlanStep, workDir: string) => void | Promise<void>;     // ⚑ live: undo a committed reversible result
  declaredEffect?: (step: PlanStep) => Effect;                       // effect ceiling per step (default: from reversibility)
  cage?: DirCageSandbox;                                             // injectable (tests); else a fresh one is created
  /** F3.3 — CAPA 3 opcional: re-verificación criptográfica de "certified".
   *  Si se inyecta, cada step con skill_id se comprueba contra este registry
   *  ANTES de tocar la jaula. Un skill_id ausente del registry, o presente
   *  pero con hash que no coincide, hace FALLAR el step de inmediato — el
   *  código nunca se ejecuta. Sin esto (default), el comportamiento es
   *  idéntico al anterior a F3.3 (retro-compatible). */
  certified?: CertifiedCheckDeps;
  approved: Set<string> | string[];
  ts: string;
}

/** Default effect ceiling from the step's reversibility (conservative). */
function defaultDeclaredEffect(step: PlanStep): Effect {
  switch (step.reversibility) {
    case 'reversible': return 'write';        // may change, but undoable
    case 'irreversible': return 'irreversible';
    case 'external_effect': return 'irreversible';  // moot — never fired
  }
}

const maxEffect = (a: Effect, b: Effect): Effect => (effectRank(a) >= effectRank(b) ? a : b);

export interface RealExecutor extends ExecuteDeps {
  cage: DirCageSandbox;
  close(): Promise<void>;
}

/**
 * Build the live ExecuteDeps for runPlan(). The returned object is passed straight
 * to runPlan(plan, executor); its runStep/revert carry the armor described above.
 */
export function makeRealExecutor(deps: RealExecDeps): RealExecutor {
  const cage = deps.cage ?? new DirCageSandbox();
  const declared = deps.declaredEffect ?? defaultDeclaredEffect;
  const snaps = new Map<string, string>();      // step_id → pre-step snapshot id (for revert)
  const committed = new Set<string>();          // steps whose result was committed to the real world
  const upstream: Record<string, string> = {};  // step_id → produced artifact (transfer)

  const runStep = async (step: PlanStep): Promise<StepResult> => {
    // (0) CAPA 3 (F3.3) — re-verificación criptográfica de "certified", ANTES
    // de tocar la jaula. feasibility.ts ya comprobó el NOMBRE; esto comprueba
    // que el ARTEFACTO a ejecutar es el que realmente se certificó. Solo
    // aplica si el caller inyectó un registry (opt-in, retro-compatible).
    if (deps.certified && step.skill_id) {
      const verdict = verifyCertifiedChecksum(step, deps.certified);
      if (!verdict.ok) {
        const detail = verdict.reason === 'not_in_registry'
          ? `"${step.skill_id}" no está en el registro de checksums certificados`
          : verdict.reason === 'no_artifact'
            ? `no se pudo calcular el checksum del artefacto a ejecutar para "${step.skill_id}"`
            : `el artefacto a ejecutar para "${step.skill_id}" NO coincide con el checksum certificado (esperado ${verdict.expectedHash?.slice(0, 12)}…, actual ${verdict.actualHash?.slice(0, 12)}…)`;
        return {
          step_id: step.step_id, status: 'failed',
          real_effect: `⚑ Capa 3 CERTIFIED_CHECKSUM_MISMATCH: ${detail}. El nombre puede figurar como certified, pero no se ejecuta código sin verificación criptográfica del artefacto.`,
        };
      }
    }

    // (2) ⚑ external effects are documented, NEVER fired — even if approved.
    if (step.reversibility === 'external_effect') {
      return {
        step_id: step.step_id, status: 'skipped',
        real_effect: `⚑ efecto externo (${step.expected_effect}): DOCUMENTADO, no disparado. Comprar/pagar/enviar nunca se ejecuta automáticamente.`,
      };
    }

    // (1) snapshot + seed COPIES of the real inputs into the cage.
    const snap = await cage.snapshot();
    snaps.set(step.step_id, snap);
    try {
      await deps.copyInputs?.(step, cage.workDir);
    } catch (e: any) {
      return { step_id: step.step_id, status: 'failed', real_effect: `no se pudieron preparar las copias de entrada: ${e?.message ?? e}` };
    }

    const before = cage.state();
    let inv: SkillInvocation;
    try {
      inv = await deps.invoke(step, { workDir: cage.workDir, upstream });
    } catch (e: any) {
      return { step_id: step.step_id, status: 'failed', real_effect: `la skill lanzó error: ${e?.message ?? e}` };
    }
    const after = cage.state();
    const changed = before.ref !== after.ref;

    // (3) CAPA 2 — 11.2: observed effect ⊆ declared. Observed = max(state-diff, tool).
    const observed = maxEffect(changed ? 'write' : 'read_only', inv.tool ? classifyEffect(inv.tool) : 'none');
    const ceiling = declared(step);
    if (!effectWithin(observed, ceiling)) {
      return {
        step_id: step.step_id, status: 'failed',
        real_effect: `⚑ Capa 2 11.2 EFFECTS_VIOLATION: efecto observado "${observed}" excede el declarado "${ceiling}". No se aplica al mundo real.`,
      };
    }

    // (3) CAPA 2 — 11.4: reported success/value must match the real result.
    const claims_success = inv.claims_success ?? inv.success;
    const post = check11_4({ tool: inv.tool ?? step.skill_id ?? 'skill', real: { success: inv.success, output: inv.output }, reported: { claims_success, claim: inv.claim }, risk: step.requires_approval ? 'high' : 'low' });
    if (!post.ok) {
      return { step_id: step.step_id, status: 'failed', real_effect: `⚑ Capa 2 ${post.detail}` };
    }

    if (!inv.success) {
      return { step_id: step.step_id, status: 'failed', real_effect: inv.output || 'la skill no completó su efecto' };
    }

    // Success in the cage. For a REVERSIBLE step that's approved (or didn't need it),
    // optionally commit the result to the real world (⚑ injected; default no-op).
    if (step.reversibility === 'reversible') {
      const approved = deps.approved instanceof Set ? deps.approved : new Set(deps.approved);
      const okToCommit = !step.requires_approval || approved.has(step.step_id);
      if (okToCommit && deps.commit) {
        try { await deps.commit(step, cage.workDir); committed.add(step.step_id); }
        catch (e: any) { return { step_id: step.step_id, status: 'failed', real_effect: `efecto producido en jaula pero falló al aplicarlo: ${e?.message ?? e}` }; }
      }
    }

    // (4) TRANSFERENCIA — carry the produced artifact forward.
    if (inv.artifact) upstream[step.step_id] = inv.artifact;

    return { step_id: step.step_id, status: 'ok', real_effect: inv.output || `hecho sobre copia (${ceiling})`, artifact_out: inv.artifact };
  };

  const revert = async (step: PlanStep): Promise<void> => {
    if (committed.has(step.step_id) && deps.uncommit) {
      try { await deps.uncommit(step, cage.workDir); } catch { /* best effort */ }
      committed.delete(step.step_id);
    }
    const snap = snaps.get(step.step_id);
    if (snap) await cage.revert(snap);   // restore the cage to the pre-step state
    delete upstream[step.step_id];
  };

  const close = async (): Promise<void> => { if (!deps.cage) await cage.dispose(); };

  return { runStep, revert, approved: deps.approved, ts: deps.ts, cage, close };
}
