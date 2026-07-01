// F2.11 (auditoría 2026-07-01) — gap de cobertura encontrado en verificación
// por mutación: orchestrator_mutex.test.ts prueba `runExclusive` como
// primitiva AISLADA, pero ningún test comprobaba que
// `ShinobiOrchestrator.process()` realmente la invoque envolviendo su
// cuerpo. Mutar `process()` para que hiciera
// `return this.processExclusive(input, opts);` (bypass del mutex) dejaba
// TODA la suite existente en verde — una regresión de un invariante de
// seguridad real (corrupción de estado estático entre misiones
// concurrentes) habría pasado inadvertida.
//
// Este test intercepta `runExclusive` con un mock que NO invoca la función
// que recibe (evita disparar el bucle LLM real de `processExclusive`, que
// necesitaría credenciales de proveedor) — solo confirma que `process()`
// (a) pasa por `runExclusive` exactamente una vez, (b) le pasa algo
// invocable (el cuerpo real, no un no-op), y (c) devuelve exactamente lo
// que `runExclusive` resuelve, sin transformarlo por su cuenta. Las tres
// aserciones juntas cierran el vector exacto que la mutación explotó.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runExclusiveMock = vi.fn(async (_fn: () => Promise<unknown>) => {
  return { intercepted: true, source: 'mocked-runExclusive' };
});

vi.mock('../orchestrator_mutex.js', () => ({
  runExclusive: runExclusiveMock,
}));

describe('F2.11 — process() enruta su ejecución a través de runExclusive (integración)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    runExclusiveMock.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('ShinobiOrchestrator.process() invoca runExclusive envolviendo su cuerpo, y devuelve lo que este resuelve', async () => {
    const { ShinobiOrchestrator } = await import('../orchestrator.js');

    // Profundidad DENTRO de límite: el check de spawn-depth en process()
    // ocurre ANTES del `return runExclusive(...)` — si el spawn depth se
    // excediera, process() retornaría antes de llegar al mutex y este test
    // no probaría nada. Se fija deliberadamente para atravesar esa línea.
    process.env.SHINOBI_SPAWN_DEPTH = '0';
    process.env.SHINOBI_MAX_SPAWN_DEPTH = '3';

    const result = await ShinobiOrchestrator.process('hola, verificación F2.11');

    expect(runExclusiveMock).toHaveBeenCalledTimes(1);
    expect(typeof runExclusiveMock.mock.calls[0][0]).toBe('function');
    expect(result).toEqual({ intercepted: true, source: 'mocked-runExclusive' });
  });
});
