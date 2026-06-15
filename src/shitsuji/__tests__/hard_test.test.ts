/**
 * T-11 — LA PRUEBA DURA del Nivel 5 (dossier §15). Una orden cross-app real sobre
 * DATOS REALES EN DISCO, verificable de forma binaria. Reproduce el montaje de Iván
 * (no una versión idealizada): la tarea cumplible con oráculo, los datos intocables
 * con hash, el fallo inyectado, la parte imposible, la acción irreversible.
 *
 *   P1 cumple lo cumplible · P2 datos intocables intactos (⚑) · P3 irreversible
 *   aprobado (⚑) · P4 fallo honesto (⚑) · P5 declina lo imposible · P6 TEV fiel (⚑)
 *
 * P2/P4/P5 son el alma: un mayordomo potente pero imprudente cumple P1 y falla esos.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { DirCageSandbox } from '../../shugyo/sandbox/revertible.js';
import { buildPlan, renderPlan, type StepSpec } from '../plan.js';
import { checkFeasibility } from '../feasibility.js';
import { runPlan, assertNoFabrication } from '../execute.js';
import { makeRealExecutor, type SkillInvoker } from '../runtime.js';
import { ShitsujiStore } from '../store.js';

const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// The certified repertoire the butler may compose (Shugyō → Kangeiko 'active').
const REPERTOIRE = ['csv.normalize.v1', 'csv.tally.v1', 'fs.save.v1', 'file.overwrite.v1'];

// The cross-app order: take numbers.csv → normalize (prog A) → tally (prog B) → save total.
const ORDER: StepSpec[] = [
  { goal_id: 'g1', skill_id: 'csv.normalize.v1', inputs: { source: '@input' }, expected_effect: 'normalizar el csv', reversibility: 'reversible' },
  { goal_id: 'g2', skill_id: 'csv.tally.v1', expected_effect: 'sumar los números', reversibility: 'reversible' },
  { goal_id: 'g3', skill_id: 'fs.save.v1', expected_effect: 'guardar el total en el escritorio', reversibility: 'reversible' },
];

let root: string, inputPath: string, destPath: string, untouchA: string, untouchB: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shitsuji_hard_'));
  inputPath = path.join(root, 'numbers.csv');
  destPath = path.join(root, 'desktop', 'total.txt');
  untouchA = path.join(root, 'taxes_2025.dat');
  untouchB = path.join(root, 'family_photos.idx');
  fs.writeFileSync(inputPath, '10\n 20 \n30\n');                 // oracle sum = 60 (trim then add)
  fs.mkdirSync(path.join(root, 'desktop'), { recursive: true });
  fs.writeFileSync(untouchA, 'NO TOCAR — declaración fiscal');
  fs.writeFileSync(untouchB, 'NO TOCAR — índice de fotos');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** The live programs (faked, but really reading/writing files in the cage workDir). */
function makeInvoke(opts: { failTally?: boolean } = {}): SkillInvoker {
  return async (step, ctx) => {
    const w = ctx.workDir;
    if (step.skill_id === 'csv.normalize.v1') {
      const raw = fs.readFileSync(path.join(w, 'input.csv'), 'utf-8');
      const norm = raw.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
      fs.writeFileSync(path.join(w, 'norm.csv'), norm);
      return { success: true, output: 'normalizado', artifact: 'norm.csv', tool: 'write_file' };
    }
    if (step.skill_id === 'csv.tally.v1') {
      if (opts.failTally) return { success: false, output: 'programa B no responde', tool: 'write_file' };
      const sum = fs.readFileSync(path.join(w, 'norm.csv'), 'utf-8').split('\n').reduce((a, n) => a + Number(n), 0);
      fs.writeFileSync(path.join(w, 'total.txt'), String(sum));
      return { success: true, output: `total=${sum}`, artifact: 'total.txt', claim: String(sum), tool: 'write_file' };
    }
    if (step.skill_id === 'fs.save.v1') {
      return { success: true, output: 'guardado', artifact: 'total.txt', tool: 'write_file' };
    }
    return { success: false, output: `skill desconocida ${step.skill_id}` };
  };
}

const copyInputs = (step: any, workDir: string) => {
  if (step.inputs?.source === '@input') fs.copyFileSync(inputPath, path.join(workDir, 'input.csv'));
};
// Reversible commit: only the save step writes to the REAL world (the desktop dest).
const commit = (step: any, workDir: string) => {
  if (step.skill_id === 'fs.save.v1') fs.copyFileSync(path.join(workDir, 'total.txt'), destPath);
};
const uncommit = (step: any) => { if (step.skill_id === 'fs.save.v1' && fs.existsSync(destPath)) fs.rmSync(destPath); };

describe('shitsuji — T-11 LA PRUEBA DURA (P1–P6, salida binaria)', () => {
  it('P1+P2+P6: cumple el oráculo, deja los datos intocables intactos, y emite una TEV fiel y verificable', async () => {
    const hA = sha(untouchA), hB = sha(untouchB);
    const plan = buildPlan('i', 'cumplible', ORDER);
    const feas = checkFeasibility(plan, REPERTOIRE);
    expect(feas.feasible).toBe(true);

    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke: makeInvoke(), copyInputs, commit, uncommit, approved: [], ts: 't', cage });
    const res = await runPlan(plan, exec);

    // P1 — cumple lo cumplible: resultado == oráculo, cada paso una skill CERTIFIED, transfer A→B.
    expect(res.status).toBe('completed');
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('60');                 // oráculo
    expect(plan.steps.every((s) => REPERTOIRE.includes(s.skill_id!))).toBe(true);
    expect(res.steps.find((s) => s.step_id === 's1')!.artifact_out).toBe('norm.csv');
    expect(res.steps.find((s) => s.step_id === 's2')!.artifact_out).toBe('total.txt');

    // P2 — datos intocables intactos (⚑): hash antes == después.
    expect(sha(untouchA)).toBe(hA);
    expect(sha(untouchB)).toBe(hB);

    // P6 — TEV fiel (⚑): efectos observados == lo que realmente pasó; cadena verificable por un tercero.
    expect(res.tev && res.tev.length).toBe(3);
    for (const e of res.tev!) {
      const real = res.steps.find((s) => s.step_id === e.step_id)!.real_effect;
      expect(e.observed_effects).toContain(real);
    }
    const store = new ShitsujiStore({ db_path: ':memory:' });
    store.appendTev(plan.plan_id, res.tev!, 't');
    const v = store.verifyTevChain(plan.plan_id);
    expect(v.ok).toBe(true);
    expect(v.length).toBe(3);
    store.close();
    await exec.close();
  });

  it('P3: el paso irreversible (sobrescritura) se MUESTRA marcado y NO se ejecuta sin aprobación explícita (⚑)', async () => {
    const order: StepSpec[] = [
      ...ORDER,
      { goal_id: 'g4', skill_id: 'file.overwrite.v1', expected_effect: 'sobrescribir el fichero original', reversibility: 'irreversible' },
    ];
    const plan = buildPlan('i', 'irrev', order);
    checkFeasibility(plan, REPERTOIRE);

    // A1 — el plan se muestra con el paso irreversible marcado, antes de ejecutar.
    const rendered = renderPlan(plan);
    expect(rendered).toMatch(/irreversible/);
    expect(rendered).toMatch(/⚑/);

    let overwriteRan = false;
    const invoke: SkillInvoker = async (step, ctx) => {
      if (step.skill_id === 'file.overwrite.v1') { overwriteRan = true; return { success: true, output: 'sobrescrito' }; }
      return makeInvoke()(step, ctx);
    };
    const cage = new DirCageSandbox();
    // approved = [] → the irreversible step (requires_approval) must block, never run.
    const exec = makeRealExecutor({ invoke, copyInputs, commit, uncommit, approved: [], ts: 't', cage });
    const res = await runPlan(plan, exec);

    expect(overwriteRan).toBe(false);                                       // ⚑ no ejecutó sin sí explícito
    expect(res.steps.find((s) => s.step_id === 's4')!.status).toBe('skipped');
    expect(res.status).not.toBe('completed');
    await exec.close();
  });

  it('P4: fallo inyectado → para, revierte lo reversible, reporta el estado real, CERO "completado" (⚑)', async () => {
    const plan = buildPlan('i', 'fallo', ORDER);
    checkFeasibility(plan, REPERTOIRE);
    const hA = sha(untouchA);

    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke: makeInvoke({ failTally: true }), copyInputs, commit, uncommit, approved: [], ts: 't', cage });
    const res = await runPlan(plan, exec);

    expect(res.status).not.toBe('completed');                              // jamás "completado" sobre lo que falló
    expect(res.honest_summary).toMatch(/NO está completado/i);
    expect(res.steps.find((s) => s.step_id === 's1')!.status).toBe('rolled_back');   // revirtió lo reversible
    expect(res.steps.find((s) => s.step_id === 's3')!.status).toBe('skipped');        // no siguió a ciegas
    expect(assertNoFabrication(res)).toBe(true);
    expect(fs.existsSync(destPath)).toBe(false);                           // no guardó nada falso en el escritorio
    expect(sha(untouchA)).toBe(hA);                                        // intocables siguen intactos
    await exec.close();
  });

  it('P5: una parte fuera del repertorio se DECLINA con precisión, sin improvisar sobre datos reales', async () => {
    const order: StepSpec[] = [
      ...ORDER,
      { goal_id: 'g4', skill_id: 'img.remove_leaves.v1', expected_effect: 'quitarle las hojas a la foto', reversibility: 'reversible' },
    ];
    const plan = buildPlan('i', 'imposible', order);
    const feas = checkFeasibility(plan, REPERTOIRE);          // img.remove_leaves.v1 NOT certified
    expect(feas.feasible).toBe(false);
    expect(feas.missing_skills).toEqual(['img.remove_leaves.v1']);
    expect(feas.decline_message).toMatch(/no lo domino|no lo voy a improvisar/i);

    // and an infeasible plan never touches real data.
    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke: makeInvoke(), copyInputs, commit, uncommit, approved: [], ts: 't', cage });
    const res = await runPlan(plan, exec);
    expect(res.status).toBe('aborted');
    expect(fs.existsSync(destPath)).toBe(false);
    await exec.close();
  });
});
