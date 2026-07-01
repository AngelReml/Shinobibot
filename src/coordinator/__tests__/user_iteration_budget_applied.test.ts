// F2.6 (auditoría 2026-07-01) — userIterationBudget(userId) existía en
// multiuser_wiring.ts (setter + persistencia vía slash command / modo
// familia) pero no tenía NINGÚN caller: el orchestrator siempre construía
// IterationBudget con el default por env/hardcoded, así que el límite
// configurado por usuario nunca se aplicaba. Este test verifica
// effectiveMaxIterations() — la función que orchestrator.ts ahora usa para
// construir el IterationBudget — sin necesitar levantar el loop LLM
// completo (ver el banner en iteration_budget.ts: extraída como función
// pura justo para esto).
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { effectiveMaxIterations, IterationBudget } from '../iteration_budget.js';

describe('F2.6 — effectiveMaxIterations aplica el límite por usuario de verdad', () => {
  afterEach(() => {
    delete process.env.SHINOBI_USERS_ROOT;
    delete process.env.SHINOBI_MAX_ITERATIONS;
  });

  it('usuario family con maxIterationsPerSession=2 → el budget efectivo es 2, no el default 10', async () => {
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    const { _resetMultiuserWiring, userRegistry } = await import('../../multiuser/multiuser_wiring.js');
    _resetMultiuserWiring();
    const reg = userRegistry();
    reg.createFamily({ userId: 'kid-budget', displayName: 'Kid', restrictions: { maxIterationsPerSession: 2 } });

    const max = effectiveMaxIterations('kid-budget');
    expect(max).toBe(2);

    // Y el IterationBudget construido con ese valor se agota exactamente a
    // las 2 iteraciones — no a las 10 del default (regresión concreta que
    // pide el plan: "el loop se detiene a las 2 iteraciones, no a las 10").
    const budget = new IterationBudget(max);
    expect(budget.consume()).toBe(true);  // 1
    expect(budget.consume()).toBe(true);  // 2
    expect(budget.consume()).toBe(false); // agotado — antes del fix habría quedado presupuesto hasta 10
  });

  it('usuario sin restricción configurada → cae al default (SHINOBI_MAX_ITERATIONS o 10), comportamiento idéntico a antes del fix', async () => {
    process.env.SHINOBI_USERS_ROOT = join(tmpdir(), `shinobi-test-${randomUUID()}`);
    const { _resetMultiuserWiring, userRegistry } = await import('../../multiuser/multiuser_wiring.js');
    _resetMultiuserWiring();
    const reg = userRegistry();
    reg.createFamily({ userId: 'no-limit-kid', displayName: 'Kid2', restrictions: { maxIterationsPerSession: 0 } });

    expect(effectiveMaxIterations('no-limit-kid')).toBe(10);
    process.env.SHINOBI_MAX_ITERATIONS = '25';
    expect(effectiveMaxIterations('no-limit-kid')).toBe(25);
  });

  it('sin userId (modo single-user / CLI) → comportamiento idéntico a antes: solo env/default', () => {
    expect(effectiveMaxIterations(undefined)).toBe(10);
    process.env.SHINOBI_MAX_ITERATIONS = '15';
    expect(effectiveMaxIterations(undefined)).toBe(15);
  });

  it('userId desconocido (no registrado) → trata como sin restricción, cae al default', () => {
    expect(effectiveMaxIterations('no-existe-este-usuario-' + randomUUID())).toBe(10);
  });
});
