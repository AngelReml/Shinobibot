// Test del enjambre orquestado: swarm_plan (DAG puro) + swarm_orchestrator
// (planner + lotes + pizarra + gate del revisor). Sin git ni LLM: se inyectan
// dobles (planner y runBatch), igual que el resto del repo aísla sus runners.

import { describe, it, expect } from 'vitest';
import { parsePlan, schedule, reviewRejected } from '../swarm_plan.js';
import { runSwarmOrchestrated, composeWithBlackboard, type BatchRunner } from '../swarm_orchestrator.js';
import type { TeamResult, TeamTask } from '../team.js';

/** runBatch doble: devuelve outputs deterministas; el revisor aprueba salvo override. */
function fakeBatch(outputs: Record<string, string> = {}): { run: BatchRunner; seen: TeamTask[][] } {
  const seen: TeamTask[][] = [];
  const run: BatchRunner = async (tasks) => {
    seen.push(tasks);
    const results = tasks.map((t) => ({
      label: t.label!, ok: true, output: outputs[t.label!] ?? `salida-${t.label}`, kept: false,
    }));
    return { results, total: results.length, succeeded: results.length, failed: 0, keptBranches: [] } as TeamResult;
  };
  return { run, seen };
}

const DAG4 = JSON.stringify([
  { id: 't1', goal: 'diseñar', role: 'architect' },
  { id: 't2', goal: 'implementar', role: 'coder', depends_on: ['t1'] },
  { id: 't3', goal: 'revisar', role: 'reviewer', depends_on: ['t2'] },
  { id: 't4', goal: 'testear', role: 'tester', depends_on: ['t2'] },
]);

describe('swarm_plan (núcleo DAG puro)', () => {
  it('parsePlan tolera vallas markdown, deduplica y normaliza rol', () => {
    const p = parsePlan('```json\n[{"id":"a","goal":"g","role":"loco"},{"id":"a","task":"h"}]\n```');
    expect(p).toHaveLength(2);
    expect(p[0].role).toBe('coder'); // rol inválido → coder
    expect(p[1].id).toBe('a_1'); // id duplicado deduplicado
    expect(p[1].goal).toBe('h'); // alias task→goal
  });

  it('schedule produce lotes topológicos y detecta ciclos', () => {
    const batches = schedule(parsePlan(DAG4));
    expect(batches.map((b) => b.map((s) => s.id))).toEqual([['t1'], ['t2'], ['t3', 't4']]);
    expect(() => schedule([
      { id: 'a', goal: 'g', role: 'coder', dependsOn: ['b'] },
      { id: 'b', goal: 'g', role: 'coder', dependsOn: ['a'] },
    ])).toThrow(/ciclo/);
  });

  it('reviewRejected bloquea con ❌/RECHAZADO y no con ✅', () => {
    expect(reviewRejected('❌ RECHAZADO: x')).toBe(true);
    expect(reviewRejected('✅ APROBADO')).toBe(false);
  });
});

describe('composeWithBlackboard (pizarra)', () => {
  it('inyecta las salidas de las dependencias presentes', () => {
    const bb = new Map([['t1', 'el diseño es X']]);
    const txt = composeWithBlackboard({ id: 't2', goal: 'implementar', role: 'coder', dependsOn: ['t1'] }, bb);
    expect(txt).toContain('el diseño es X');
    expect(txt).toContain('implementar');
  });
  it('sin dependencias devuelve el goal tal cual', () => {
    const txt = composeWithBlackboard({ id: 't1', goal: 'diseñar', role: 'architect', dependsOn: [] }, new Map());
    expect(txt).toBe('diseñar');
  });
});

describe('runSwarmOrchestrated (planner + lotes + pizarra + revisor)', () => {
  it('flujo feliz: DAG de 4, revisor aprueba → completed con pizarra cableada', async () => {
    const { run, seen } = fakeBatch({ t3: '✅ APROBADO: bien' });
    const r = await runSwarmOrchestrated({ task: 'construir X', planner: async () => DAG4, runBatch: run, verify: false });
    expect(r.status).toBe('completed');
    expect(r.batches).toEqual([['t1'], ['t2'], ['t3', 't4']]);
    // pizarra: el lote de t2 recibió la salida de t1 en su prompt
    expect(seen[1][0].task).toContain('salida-t1');
    expect(r.members.filter((m) => m.ok)).toHaveLength(4);
  });

  it('el revisor bloquea → status rejected y el lote posterior NO se ejecuta', async () => {
    const plan = JSON.stringify([
      { id: 'c', goal: 'picar', role: 'coder' },
      { id: 'rev', goal: 'revisar', role: 'reviewer', depends_on: ['c'] },
      { id: 'final', goal: 'desplegar', role: 'coder', depends_on: ['rev'] },
    ]);
    const { run, seen } = fakeBatch({ rev: '❌ RECHAZADO: inseguro' });
    const r = await runSwarmOrchestrated({ task: 'x', planner: async () => plan, runBatch: run, verify: false });
    expect(r.status).toBe('rejected');
    expect(r.rejectedBy).toBe('rev');
    const ranLabels = seen.flat().map((t) => t.label);
    expect(ranLabels).not.toContain('final');
  });

  it('plan ilegible → fallback a una sola subtarea de coder', async () => {
    const { run } = fakeBatch();
    const r = await runSwarmOrchestrated({ task: 'haz algo', planner: async () => 'no json', runBatch: run, verify: false });
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0].role).toBe('coder');
  });
});
