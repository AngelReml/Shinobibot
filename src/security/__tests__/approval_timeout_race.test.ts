// F2.12 (auditoría 2026-07-01) — el bloque "Timeout→DENY" de
// security_invariants.test.ts era decorativo: comparaba
// `(process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION || 'deny')` consigo mismo,
// sin ejecutar NINGÚN código real de aprobación. Un cambio real en la
// lógica (p.ej. invertir el default) habría dejado ese test en verde.
//
// `raceApprovalWithTimeout` (extraída de coordinator/orchestrator.ts, la
// MISMA función que usa el loop real hoy) sí es testeable de verdad: se
// registra un asker que NUNCA resuelve (fuerza que la carrera Promise.race
// se decida por el timeout, no por una denegación inmediata por falta de
// asker), se espera el timeout real con ms bajos, y se asserta sobre el
// RESULTADO de la función — no sobre una constante releída.
//
// Mutación de control (requisito explícito del plan): si alguien invirtiera
// el default de 'deny' a 'approve' en el código real, el primer test de
// abajo DEBE fallar. Se puede verificar manualmente cambiando
// `'deny'` → `'approve'` en el default de `raceApprovalWithTimeout`
// (security/approval.ts) y re-corriendo este archivo: sin el fix, pasaría
// igual (decorativo); con el fix, falla (ya no lo es).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  raceApprovalWithTimeout,
  setApprovalAsker,
  clearSessionApprovals,
} from '../approval.js';

describe('F2.12 — raceApprovalWithTimeout: la ruta REAL de timeout deniega por defecto', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SHINOBI_APPROVAL_TIMEOUT_MS = '60';
    clearSessionApprovals();
  });

  afterEach(() => {
    setApprovalAsker(null);
    clearSessionApprovals();
    process.env = originalEnv;
  });

  it('asker que nunca resuelve + timeout expira → approved=false, isTimeout=true (default real, no releído)', async () => {
    delete process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION;
    setApprovalAsker(() => new Promise(() => { /* nunca resuelve */ }));

    const result = await raceApprovalWithTimeout({
      toolName: 'run_command',
      args: { command: 'rm -rf /tmp/x' },
      destructive: true,
      reason: 'test',
    });

    expect(result.isTimeout).toBe(true);
    expect(result.approved).toBe(false); // ← el invariante real, ejercido de verdad
  });

  it('SHINOBI_APPROVAL_TIMEOUT_ACTION=approve invierte el comportamiento (documentado, opt-in explícito)', async () => {
    process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION = 'approve';
    setApprovalAsker(() => new Promise(() => { /* nunca resuelve */ }));

    const result = await raceApprovalWithTimeout({
      toolName: 'run_command',
      args: { command: 'echo hi' },
      destructive: true,
      reason: 'test',
    });

    expect(result.isTimeout).toBe(true);
    expect(result.approved).toBe(true); // opt-in explícito, comportamiento documentado
  });

  it('un asker que responde ANTES del timeout gana la carrera — no espera el timeout innecesariamente', async () => {
    delete process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION;
    setApprovalAsker(async () => 'yes');

    const result = await raceApprovalWithTimeout({
      toolName: 'run_command',
      args: {},
      destructive: true,
      reason: 'test',
    });

    // `isTimeout === false` ES la prueba de que ganó el asker y no el timeout:
    // si la carrera se hubiera decidido por el timeout, isTimeout sería true y
    // approved sería false (default deny). Medir `elapsed < 60 ms` era redundante
    // con esto y flakeaba bajo GC/carga (el timeout del test es de solo 60 ms).
    expect(result.approved).toBe(true);
    expect(result.isTimeout).toBe(false);
  });

  it('tool no-destructiva no depende del timeout en absoluto (requestApproval la aprueba directo)', async () => {
    setApprovalAsker(() => new Promise(() => {})); // ni siquiera se debería consultar
    const result = await raceApprovalWithTimeout({
      toolName: 'read_file',
      args: {},
      destructive: false,
    });
    expect(result.approved).toBe(true);
    expect(result.isTimeout).toBe(false);
  });
});
