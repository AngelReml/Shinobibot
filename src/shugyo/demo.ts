/**
 * shugyo/demo.ts — S-15: scaffold del PROMPT WOW (§16). "Coge el programa más jugoso
 * y seguro del mapa y apréndetelo en tu jaula; antes de tocar nada que huela a borrar/
 * enviar/pagar, párate; cuando lo sepas, conviértelo en skills certificadas que no se
 * salgan de su contrato."
 *
 * Corre selección→exploración en jaula→síntesis→certificación→publicación a Kagami,
 * con el ejecutor de la jaula INYECTADO (la exploración viva ⚑) — el operador lo cambia
 * por el backend real. Lo que demuestra: aprende sin romper (jaula revertible),
 * external_effect nunca se dispara, y solo certifica lo que respeta sus efectos.
 */

import { selectTarget } from './target.js';
import { classifyReversibility, executionPolicy } from './explore/reversibility.js';
import { DirCageSandbox, type CageExecutor } from './sandbox/revertible.js';
import { synthesizeSkill, certifyInCage, type CertCase, type SkillManifest } from './synth/certify.js';
import { publishToKagami } from './adapters.js';
import type { AppCard } from '../chizu/types.js';
import type { Capability } from './types.js';
import type { CapabilityCell as KagamiCell } from '../kagami/types.js';

export interface ForgeResult { certified: boolean; cell: KagamiCell | null; narration: string; }

/**
 * @param candidates  Chizu cards to pick a target from (safe/automatable first).
 * @param capability  the capability learned by exploration (the model induction).
 * @param manifest    its synthesized manifest's effect declaration inputs.
 * @param cases       the oracle cert cases.
 * @param executor    ⚑ LIVE: the cage executor (faked here; real backend in prod).
 */
export async function runForgeDemo(
  candidates: AppCard[],
  capability: Capability,
  decl: { command: string; declared_tools: string[]; declared_effects: SkillManifest['declared_effects'] },
  cases: CertCase[],
  executor: CageExecutor,
  probedAffordances: string[] = [],
): Promise<ForgeResult> {
  const N = ['🔨 APRENDE EL PROGRAMA (demo):'];
  const target = selectTarget(candidates);
  if (!target) return { certified: false, cell: null, narration: 'No hay objetivo seguro/automatizable en el mapa.' };
  N.push(`OBJETIVO: ${target.app.display_name} vía ${target.via} (${target.reason}).`);

  // Prudence: anything that smells of delete/send/pay is NOT executed on real data.
  for (const aff of probedAffordances) {
    const rev = classifyReversibility(aff);
    const policy = executionPolicy(rev);
    if (rev === 'external_effect') N.push(`  ⚑ "${aff}" → external_effect: DOCUMENTADO, no disparado.`);
    else if (rev === 'destructive' || rev === 'unknown') N.push(`  ⚠ "${aff}" → ${rev}: solo en jaula (${policy}).`);
  }

  const { skill, manifest } = synthesizeSkill(capability, { app_id: target.app.app_id, via: target.via as any, command: decl.command, declared_tools: decl.declared_tools, declared_effects: decl.declared_effects });
  const cage = new DirCageSandbox({ executor });
  try {
    const res = await certifyInCage(manifest, cases, cage, { grade: skill.grade });
    const certified = res.status === 'certified';
    N.push(`CERTIFICACIÓN: ${res.status.toUpperCase()}${res.reason ? ` — ${res.reason}` : ''} (${res.cases.filter((c) => c.passed).length}/${res.cases.length} casos).`);
    let cell: KagamiCell | null = null;
    if (certified) {
      const passRate = res.cases.filter((c) => c.passed).length / Math.max(1, res.cases.length);
      cell = publishToKagami({ ...skill, status: 'certified' }, { success_rate: passRate, sample_size: res.cases.length, declared_confidence: 0.9, measured_at: 't', source_bank: 'cert' });
      N.push(`PUBLICADO A KAGAMI: ${cell.capability_id} → ${cell.verdict}.`);
    }
    return { certified, cell, narration: N.join('\n') };
  } finally {
    await cage.dispose();
  }
}
