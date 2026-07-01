// F2.11 (auditoría 2026-07-01) — el mutex del orchestrator ahora se
// adquiere DENTRO de ShinobiOrchestrator.process() (ver orchestrator.ts:
// process() → runExclusive(() => this.processExclusive(...))). Los 4
// call-sites externos preexistentes (web/server.ts, telegram_channel.ts,
// http_channel.ts, channels_wiring.ts) siguen envolviendo process() en
// runExclusive por su cuenta — eso ahora es una llamada ANIDADA (reentrante)
// sobre la misma cadena. Sin manejo especial, runExclusive (basado en una
// única cola de promesas) deadlockearía: la llamada externa espera a que
// su propio fn termine, pero ese fn espera a la interna, que espera a que
// la cola (bloqueada por la externa) avance. Este test verifica, de forma
// aislada (sin levantar el loop LLM completo), que:
//   1. Dos llamadas ANIDADAS a runExclusive no deadlockean.
//   2. Dos llamadas CONCURRENTES (no anidadas) SÍ se serializan de verdad
//      (nunca dos `fn` en vuelo a la vez) — la garantía original se
//      preserva, la reentrancia no la debilita para el caso no-anidado.
import { describe, it, expect } from 'vitest';
import { runExclusive } from '../orchestrator_mutex.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('F2.11 — orchestrator_mutex: runExclusive es reentrante sin deadlock', () => {
  it('una llamada ANIDADA (misma cadena async) se resuelve inline, sin colgarse', async () => {
    const order: string[] = [];
    const outer = runExclusive(async () => {
      order.push('outer-start');
      // Llamada anidada: simula el caso real — un call-site externo que
      // envuelve process() en runExclusive, y process() vuelve a adquirir
      // el mutex internamente para processExclusive().
      const inner = await runExclusive(async () => {
        order.push('inner');
        return 'inner-result';
      });
      order.push('outer-end');
      return `outer:${inner}`;
    });

    // Si esto colgara (deadlock), el test timeout (10s por defecto) lo
    // delataría. La aserción real es que SÍ resuelve, con el orden correcto.
    const result = await outer;
    expect(result).toBe('outer:inner-result');
    expect(order).toEqual(['outer-start', 'inner', 'outer-end']);
  });

  it('dos llamadas CONCURRENTES (no anidadas) se serializan de verdad — nunca dos en vuelo a la vez', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    async function task(name: string, ms: number) {
      return runExclusive(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`${name}-start`);
        await sleep(ms);
        order.push(`${name}-end`);
        inFlight--;
        return name;
      });
    }

    const [a, b, c] = await Promise.all([task('A', 20), task('B', 5), task('C', 10)]);

    expect(maxInFlight).toBe(1); // nunca más de una ejecución simultánea
    expect([a, b, c]).toEqual(['A', 'B', 'C']);
    // Cada tarea debe completar (start→end) ANTES de que empiece la siguiente.
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end']);
  });

  it('un fallo en una tarea no rompe la cadena para las siguientes', async () => {
    const results: string[] = [];
    await runExclusive(async () => { results.push('first'); }).catch(() => {});
    await expect(runExclusive(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await runExclusive(async () => { results.push('third'); });
    expect(results).toEqual(['first', 'third']);
  });

  it('reentrancia con fallo en la llamada anidada propaga el error al caller externo (no deadlock silencioso)', async () => {
    await expect(
      runExclusive(async () => {
        await runExclusive(async () => {
          throw new Error('nested-boom');
        });
      }),
    ).rejects.toThrow('nested-boom');

    // La cadena sigue viva tras el fallo anidado.
    const after = await runExclusive(async () => 'ok');
    expect(after).toBe('ok');
  });
});
