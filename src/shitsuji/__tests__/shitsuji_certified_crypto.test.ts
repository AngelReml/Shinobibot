// F3.3 — "certified" ya no es solo membresía de nombre en un Set. Este test
// prueba que una skill cuyo skill_id SÍ está en el repertorio certificado
// (feasibility.ts pasa, membresía de nombre) pero cuyo checksum del
// artefacto a ejecutar NO coincide con el hash certificado por Shugyō es
// RECHAZADA antes de invocar la skill — sin tocar la jaula, sin ejecutar
// nada. La Capa 2 preexistente (jaula/external_effect/11.2/11.4) se prueba
// intacta reutilizando el mismo fixture que hard_test.test.ts (T-11).

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { buildPlan, type StepSpec } from '../plan.js';
import { checkFeasibility } from '../feasibility.js';
import { runPlan } from '../execute.js';
import { makeRealExecutor, type SkillInvoker } from '../runtime.js';
import { buildCertifiedRegistry, verifyCertifiedChecksum, defaultStepArtifactHash } from '../certified_registry.js';
import { DirCageSandbox } from '../../shugyo/sandbox/revertible.js';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// El repertorio de NOMBRES certificados (lo que feasibility.ts consulta) —
// idéntico al patrón de adapters.ts::certifiedRepertoire.
const REPERTOIRE = ['csv.tally.v1'];

describe('shitsuji — F3.3 re-verificación criptográfica de "certified"', () => {
  it('verifyCertifiedChecksum: not_in_registry cuando el skill_id no tiene hash registrado', () => {
    const step = { step_id: 's1', goal_id: 'g1', skill_id: 'unknown.v1', inputs: { command: 'echo hi' }, expected_effect: 'x', reversibility: 'reversible' as const, on_copy: false, requires_approval: false };
    const registry = buildCertifiedRegistry([{ skill_id: 'csv.tally.v1', artifact_hash: sha256('echo total') }]);
    const v = verifyCertifiedChecksum(step, { registry });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('not_in_registry');
  });

  it('verifyCertifiedChecksum: hash_mismatch cuando el artefacto real difiere del certificado', () => {
    const certifiedCommand = 'run_tally --strict';
    const tamperedStep = { step_id: 's1', goal_id: 'g1', skill_id: 'csv.tally.v1', inputs: { command: 'run_tally --UNSAFE' }, expected_effect: 'x', reversibility: 'reversible' as const, on_copy: false, requires_approval: false };
    const registry = buildCertifiedRegistry([{ skill_id: 'csv.tally.v1', artifact_hash: sha256(certifiedCommand) }]);
    const v = verifyCertifiedChecksum(tamperedStep, { registry });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
  });

  it('verifyCertifiedChecksum: ok cuando el artefacto coincide exactamente con el certificado', () => {
    const certifiedCommand = 'run_tally --strict';
    const step = { step_id: 's1', goal_id: 'g1', skill_id: 'csv.tally.v1', inputs: { command: certifiedCommand }, expected_effect: 'x', reversibility: 'reversible' as const, on_copy: false, requires_approval: false };
    const registry = buildCertifiedRegistry([{ skill_id: 'csv.tally.v1', artifact_hash: sha256(certifiedCommand) }]);
    const v = verifyCertifiedChecksum(step, { registry });
    expect(v.ok).toBe(true);
  });

  it('END-TO-END: nombre certified (pasa feasibility) pero checksum manipulado → runPlan rechaza el step ANTES de invocar la skill', async () => {
    const certifiedCommand = 'run_tally --strict';
    const specs: StepSpec[] = [
      { goal_id: 'g1', skill_id: 'csv.tally.v1', inputs: { command: 'run_tally --EVIL_PAYLOAD' }, expected_effect: 'sumar', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'p', specs);
    // Capa 1 — feasibility pasa: el NOMBRE 'csv.tally.v1' SÍ está en el repertorio.
    const feas = checkFeasibility(plan, REPERTOIRE);
    expect(feas.feasible).toBe(true);

    let invoked = false;
    const invoke: SkillInvoker = async () => { invoked = true; return { success: true, output: 'no debería llegar aquí' }; };

    const registry = buildCertifiedRegistry([{ skill_id: 'csv.tally.v1', artifact_hash: sha256(certifiedCommand) }]);
    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({
      invoke, approved: [], ts: 't', cage,
      certified: { registry }, // opt-in a la Capa 3
    });
    const res = await runPlan(plan, exec);

    // El step fue rechazado por checksum, NUNCA se invocó la skill.
    expect(invoked).toBe(false);
    expect(res.status).not.toBe('completed');
    expect(res.steps[0].status).toBe('failed');
    expect(res.steps[0].real_effect).toMatch(/CERTIFIED_CHECKSUM_MISMATCH/);
    await exec.close();
  });

  it('END-TO-END: checksum coincide → el step procede normalmente a la Capa 2 (jaula/11.2/11.4 intactas)', async () => {
    const certifiedCommand = 'run_tally --strict';
    const specs: StepSpec[] = [
      { goal_id: 'g1', skill_id: 'csv.tally.v1', inputs: { command: certifiedCommand }, expected_effect: 'sumar', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, REPERTOIRE);

    const invoke: SkillInvoker = async () => ({ success: true, output: 'total=60', tool: 'write_file' });
    const registry = buildCertifiedRegistry([{ skill_id: 'csv.tally.v1', artifact_hash: sha256(certifiedCommand) }]);
    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke, approved: [], ts: 't', cage, certified: { registry } });
    const res = await runPlan(plan, exec);

    expect(res.status).toBe('completed');
    expect(res.steps[0].status).toBe('ok');
    await exec.close();
  });

  it('sin registry inyectado (default), el comportamiento es idéntico al pre-F3.3 — retro-compatible', async () => {
    const specs: StepSpec[] = [
      { goal_id: 'g1', skill_id: 'csv.tally.v1', inputs: { command: 'anything, unverified' }, expected_effect: 'sumar', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'p', specs);
    checkFeasibility(plan, REPERTOIRE);
    const invoke: SkillInvoker = async () => ({ success: true, output: 'total=60' });
    const cage = new DirCageSandbox();
    // Sin `certified:` — la Capa 3 es un no-op.
    const exec = makeRealExecutor({ invoke, approved: [], ts: 't', cage });
    const res = await runPlan(plan, exec);
    expect(res.status).toBe('completed');
    await exec.close();
  });

  it('defaultStepArtifactHash calcula sha256 del comando renderizado', () => {
    const step = { step_id: 's1', goal_id: 'g1', skill_id: 'x', inputs: { command: 'foo' }, expected_effect: '', reversibility: 'reversible' as const, on_copy: false, requires_approval: false };
    expect(defaultStepArtifactHash(step)).toBe(sha256('foo'));
  });

  it('defaultStepArtifactHash devuelve undefined si el step no trae inputs.command', () => {
    const step = { step_id: 's1', goal_id: 'g1', skill_id: 'x', inputs: {}, expected_effect: '', reversibility: 'reversible' as const, on_copy: false, requires_approval: false };
    expect(defaultStepArtifactHash(step)).toBeUndefined();
  });
});
