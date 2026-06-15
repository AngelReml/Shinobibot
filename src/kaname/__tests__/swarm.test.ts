/**
 * KN-06 — orquestador del enjambre: reparto disjunto, lanzamiento (inyectado),
 * integración que bloquea escrituras al núcleo, salida cruda de verificadores.
 */
import { describe, it, expect, vi } from 'vitest';
import { assignFronts, integrateWrites, orchestrateSwarm, type LaunchClaude } from '../swarm.js';

describe('kaname — KN-06 enjambre', () => {
  it('reparto disjunto: cada worker su frente y su workspace propio', () => {
    const ws = assignFronts(['fA', 'fB', 'fC']);
    expect(ws.map((w) => w.assigned_front)).toEqual(['fA', 'fB', 'fC']);
    expect(new Set(ws.map((w) => w.workspace)).size).toBe(3);   // sin colisión
  });

  it('integración: escrituras a userspace pasan, a núcleo se BLOQUEAN', () => {
    const r = integrateWrites(['src/shugyo/new_skill.ts', 'src/integrity/checks.ts', 'src/kagemusha/x.ts']);
    expect(r.accepted).toEqual(['src/shugyo/new_skill.ts', 'src/kagemusha/x.ts']);
    expect(r.blocked).toEqual(['src/integrity/checks.ts']);
  });

  it('N constructores en paralelo: uno intenta tocar el núcleo → bloqueado, los demás OK', async () => {
    const launch: LaunchClaude = async (w) => w.assigned_front === 'evil'
      ? { worker_id: w.worker_id, front: w.assigned_front, writes: ['src/coordinator/orchestrator.ts'], ok: true }
      : { worker_id: w.worker_id, front: w.assigned_front, writes: [`src/skills/${w.assigned_front}.ts`], ok: true };
    const res = await orchestrateSwarm(['s1', 's2', 'evil', 's3'], { launch, prompt: (f) => `build ${f}`, concurrency: 2 });
    expect(res.blocked_core_writes).toEqual([{ worker_id: 'builder_3', path: 'src/coordinator/orchestrator.ts' }]);
    expect(res.workers.find((w) => w.assigned_front === 'evil')!.status).toBe('failed');
    expect(res.workers.filter((w) => w.status === 'done')).toHaveLength(3);   // los honestos entran
  });

  it('verificador devuelve salida CRUDA, no narración', async () => {
    const launch = vi.fn<LaunchClaude>(async (w) => ({ worker_id: w.worker_id, front: w.assigned_front, writes: [], ok: true, raw_output: 'Tests 7 passed (7)\nDuration 0.4s' }));
    const res = await orchestrateSwarm(['hard_test'], { launch, prompt: () => 'verify', role: 'verifier' });
    expect(res.results[0].raw_output).toMatch(/Tests 7 passed/);
    expect(res.workers[0].role).toBe('verifier');
  });

  it('respeta el cap de concurrencia (cola/backoff §7.3)', async () => {
    let inFlight = 0, maxSeen = 0;
    const launch: LaunchClaude = async (w) => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await Promise.resolve();
      inFlight--;
      return { worker_id: w.worker_id, front: w.assigned_front, writes: [], ok: true };
    };
    await orchestrateSwarm(['a', 'b', 'c', 'd', 'e'], { launch, prompt: () => 'x', concurrency: 2 });
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
