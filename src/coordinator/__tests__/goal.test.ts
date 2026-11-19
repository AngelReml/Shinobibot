import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setGoal, getGoal, clearGoal, pauseGoal, resumeGoal, runGoalLoop, parseJudgeReply,
  continuationPrompt, describeGoal, defaultMaxTurns, type GoalJudge,
} from '../goal.js';

const yes = { done: true, reason: 'la prueba pasa' };
const no = (r = 'falta el test') => ({ done: false, reason: r });

describe('objetivo fijo (/goal)', () => {
  beforeEach(() => { clearGoal(); delete process.env.SHINOBI_GOAL_MAX_TURNS; });

  it('sigue hasta que el juez lo da por cumplido y reinyecta lo que falta', async () => {
    setGoal('arregla los avisos y demuéstralo');
    const inputs: string[] = [];
    const runTurn = vi.fn(async (i: string) => { inputs.push(i); return { output: `turno ${inputs.length}` }; });
    const judge: GoalJudge = vi.fn()
      .mockResolvedValueOnce(no('quedan 3 avisos'))
      .mockResolvedValueOnce(no('queda 1 aviso'))
      .mockResolvedValueOnce(yes);
    const res = await runGoalLoop('arregla los avisos y demuéstralo', runTurn, judge);
    expect(res.status).toBe('done');
    expect(res.turns).toBe(3);
    expect(inputs[0]).toBe('arregla los avisos y demuéstralo');
    expect(inputs[1]).toContain('quedan 3 avisos');
    expect(inputs[2]).toContain('queda 1 aviso');
    expect(getGoal()?.lastVerdict).toEqual(yes);
  });

  it('se agota al llegar al tope de turnos y no hace ni uno más', async () => {
    setGoal('meta imposible', 3);
    const runTurn = vi.fn(async () => ({ output: 'sigo' }));
    const res = await runGoalLoop('meta imposible', runTurn, async () => no());
    expect(res.status).toBe('exhausted');
    expect(runTurn).toHaveBeenCalledTimes(3);
  });

  it('si el juez falla dos veces seguidas, pausa en vez de seguir gastando', async () => {
    setGoal('meta', 20);
    const runTurn = vi.fn(async () => ({ output: 'x' }));
    const judge: GoalJudge = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('red caída'));
    const res = await runGoalLoop('meta', runTurn, judge);
    expect(res.status).toBe('paused');
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(getGoal()?.pausedReason).toMatch(/juez/);
  });

  it('un fallo aislado del juez no pausa: el contador se reinicia con un veredicto válido', async () => {
    setGoal('meta', 20);
    const judge: GoalJudge = vi.fn()
      .mockResolvedValueOnce(null).mockResolvedValueOnce(no()).mockResolvedValueOnce(null).mockResolvedValueOnce(yes);
    const res = await runGoalLoop('meta', async () => ({ output: 'x' }), judge);
    expect(res.status).toBe('done');
    expect(res.turns).toBe(4);
  });

  it('si se pausa o se borra durante un turno, para al acabar ese turno sin llamar al juez', async () => {
    setGoal('meta');
    const judge = vi.fn(async () => no());
    const res = await runGoalLoop('meta', async () => { pauseGoal(); return { output: 'x' }; }, judge);
    expect(res.status).toBe('paused');
    expect(judge).not.toHaveBeenCalled();
    setGoal('otra');
    const g = getGoal();
    const r2 = await runGoalLoop('otra', async () => { clearGoal(); return { output: 'x' }; }, judge);
    expect(r2.turns).toBe(1);
    expect(getGoal()).toBeNull();
    expect(g?.status).toBe('active');
  });

  it('no corre si no hay objetivo activo', async () => {
    const runTurn = vi.fn();
    expect((await runGoalLoop('x', runTurn)).turns).toBe(0);
    setGoal('m'); pauseGoal();
    await runGoalLoop('m', runTurn);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('el error de un turno llega al juez como parte de la respuesta', async () => {
    setGoal('meta', 1);
    const judge = vi.fn(async (_g: string, out: string) => { expect(out).toContain('disco lleno'); return no(); });
    await runGoalLoop('meta', async () => ({ verdict: 'ERROR', error: 'disco lleno' }), judge);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('parseJudgeReply tolera texto alrededor y rechaza lo ilegible', () => {
    expect(parseJudgeReply('{"done": true, "reason": "tests en verde"}')).toEqual({ done: true, reason: 'tests en verde' });
    expect(parseJudgeReply('Claro:\n```json\n{"done":false,"reason":"falta \\"ruff check\\""}\n```')).toEqual({ done: false, reason: 'falta "ruff check"' });
    expect(parseJudgeReply('{"reason":"x","done":true}')?.done).toBe(true);
    expect(parseJudgeReply('creo que sí')).toBeNull();
    expect(parseJudgeReply('')).toBeNull();
  });

  it('setGoal valida, respeta SHINOBI_GOAL_MAX_TURNS y resume amplía un objetivo agotado', () => {
    expect(() => setGoal('   ')).toThrow();
    expect(defaultMaxTurns()).toBe(20);
    process.env.SHINOBI_GOAL_MAX_TURNS = '7';
    expect(setGoal('m').maxTurns).toBe(7);
    expect(setGoal('m', 2).maxTurns).toBe(2);
    const g = getGoal()!; g.status = 'exhausted';
    expect(resumeGoal()?.status).toBe('active');
    expect(getGoal()?.maxTurns).toBe(9);
  });

  it('se pausa sin consultar al juez si el agente ha preguntado algo al usuario (clarify)', async () => {
    setGoal('migrar la base de datos');
    const runTurn = vi.fn(async () => ({ response: '¿SQLite o Postgres?', needs_user: true }));
    const judge: GoalJudge = vi.fn();
    const r = await runGoalLoop('empieza', runTurn, judge);
    expect(r.status).toBe('paused');
    expect(r.turns).toBe(1);
    expect(judge).not.toHaveBeenCalled();
    expect(getGoal()?.pausedReason).toMatch(/respuesta tuya/);
  });

  it('describe el estado en cristiano y el mensaje de continuación recuerda la meta', () => {
    expect(describeGoal(null)).toMatch(/No hay objetivo/);
    setGoal('subir la web');
    expect(describeGoal()).toMatch(/en marcha \(0\/20 turnos\)/);
    const p = continuationPrompt('subir la web', no('falta el dominio'));
    expect(p).toContain('subir la web');
    expect(p).toContain('falta el dominio');
  });
});
