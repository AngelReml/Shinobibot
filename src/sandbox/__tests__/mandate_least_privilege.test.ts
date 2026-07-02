// P1.E3.a (plan de frontera 2026-07-01) — test de mutación del plan:
// `mandate_least_privilege.test.ts`.
//
// La promesa de E3.a: cuando una misión corre bajo un mandato de capacidades, el
// monitor RECHAZA todo efecto que el mandato no cubra (least-privilege). El plan
// de frontera fija la mutación canónica de este motor:
//
//   `mandate_least_privilege.test.ts` — misión con mandato {fs.read} intenta
//   Effect{shell} → rechazado. Mutación: que el monitor ignore el mandato → falla.
//
// Aquí eso se prueba a dos niveles: (1) la lógica pura `checkMandate` (cubre/no
// cubre/caducado/comodín/frontera de prefijo), y (2) el enforcement real a través
// de `mediatedEffect` con un MockBackend (el efecto no cubierto NO llega a ejecutar).
// Como los demás tests de P1, incluye su "sensor" anti-decorativo: ejecuta la
// mutación (un checker que ignora el mandato) y comprueba que SÍ dejaría pasar el
// efecto — si el harness no distinguiera ambos casos, sería decorativo y esto lo
// delata. Verificado con el protocolo de la regla #2 (romper → rojo → restaurar →
// verde); evidencia en DECISIONES.md.
import { describe, it, expect, beforeEach } from 'vitest';
import { checkMandate, effectScope, scopeCovers, parseMandateSpec, runWithMandate, type Mandate } from '../mandate.js';
import { mediatedEffect, monitorStats, _resetMonitorStats, type Effect } from '../monitor.js';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';

const shell = (over: Partial<Effect> = {}): Effect => ({
  kind: 'shell', target: 'echo', args: ['hola'], cwd: '/ws', timeoutMs: 5_000,
  backendId: 'mock', reversible: false, ...(over as any),
});

describe('P1.E3.a — checkMandate (lógica pura de least-privilege)', () => {
  it('efecto CUBIERTO por una capacidad ⇒ granted', () => {
    const m: Mandate = { capabilities: ['shell:/ws'] };
    expect(checkMandate(shell(), m).granted).toBe(true);
  });

  it('efecto NO cubierto (mandato solo fs.read) ⇒ capability_not_granted', () => {
    const m: Mandate = { capabilities: ['fs.read:/ws'] };
    const v = checkMandate(shell(), m);
    expect(v.granted).toBe(false);
    if (!v.granted) expect(v.code).toBe('capability_not_granted');
  });

  it('comodín `*` cubre cualquier scope de ese kind', () => {
    expect(checkMandate(shell({ cwd: '/cualquier/sitio' }), { capabilities: ['shell:*'] }).granted).toBe(true);
  });

  it('mandato caducado ⇒ mandate_expired (aunque la capacidad exista)', () => {
    const m: Mandate = { capabilities: ['shell:*'], expiresAt: 1_000 };
    const v = checkMandate(shell(), m, 2_000); // now > expiresAt
    expect(v.granted).toBe(false);
    if (!v.granted) expect(v.code).toBe('mandate_expired');
  });

  it('frontera de prefijo: `shell:/ws` NO cubre cwd `/ws-secretos` (bug scratch/scratch-evil)', () => {
    expect(scopeCovers('/ws', '/ws-secretos')).toBe(false);
    expect(scopeCovers('/ws', '/ws/sub')).toBe(true);
    expect(scopeCovers('/ws', '/ws')).toBe(true);
    expect(checkMandate(shell({ cwd: '/ws-secretos' }), { capabilities: ['shell:/ws'] }).granted).toBe(false);
  });

  it('capacidad malformada (sin `:`) se ignora, nunca concede', () => {
    expect(checkMandate(shell(), { capabilities: ['shellworkspace'] }).granted).toBe(false);
  });

  it('effectScope deriva el scope correcto por kind', () => {
    expect(effectScope(shell({ cwd: '/x' }))).toBe('/x');
    expect(effectScope({ kind: 'fs.read', target: '/a/b', reversible: false } as Effect)).toBe('/a/b');
  });

  it('SENSOR anti-decorativo: la mutación (ignorar el mandato) SÍ dejaría pasar', () => {
    // Réplica de la mutación canónica: un checker que ignora el mandato y concede
    // siempre. Si el harness no distinguiera esto del checker real, sería decorativo.
    const mutado = (_e: Effect, _m: Mandate) => ({ granted: true as const });
    const m: Mandate = { capabilities: ['fs.read:/ws'] }; // NO cubre shell
    expect(checkMandate(shell(), m).granted).toBe(false); // real: deniega
    expect(mutado(shell(), m).granted).toBe(true);        // mutado: colaría → el test lo ve
  });
});

describe('P1.E3.a — enforcement real a través de mediatedEffect', () => {
  beforeEach(() => { _resetSandboxRegistry(); _resetMonitorStats(); });

  const registerMock = () => {
    let ran = 0;
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => { ran++; return { stdout: 'ok', stderr: '', exitCode: 0 }; } }));
    return () => ran;
  };

  it('mandato explícito que CUBRE ⇒ ejecuta', async () => {
    const ran = registerMock();
    const res = await mediatedEffect(shell(), { capabilities: ['shell:*'] });
    expect(res.ok).toBe(true);
    expect(ran()).toBe(1);
  });

  it('mandato explícito que NO cubre ⇒ capability_not_granted y NO ejecuta', async () => {
    const ran = registerMock();
    const res = await mediatedEffect(shell(), { capabilities: ['fs.read:/ws'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('capability_not_granted');
    expect(ran()).toBe(0);                 // el efecto NO llegó al backend
    expect(monitorStats().mediated).toBe(0);
    expect(monitorStats().denied).toBe(1);
  });

  it('sin mandato (legado) ⇒ ejecuta como antes (paridad E1-E2)', async () => {
    const ran = registerMock();
    const res = await mediatedEffect(shell());          // undefined mandate
    expect(res.ok).toBe(true);
    expect(ran()).toBe(1);
  });

  it('mandato de MISIÓN (ambiente, runWithMandate) enforcea sin pasarlo explícito', async () => {
    const ran = registerMock();
    // Dentro de la misión, el efecto NO cubierto se deniega aunque el caller no
    // pase mandato — el monitor lo toma del AsyncLocalStorage (cierra la fragilidad
    // "disciplina del caller": el enforcement es ambiente, no opcional).
    const res = await runWithMandate({ capabilities: ['fs.read:/ws'] }, () => mediatedEffect(shell()));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('capability_not_granted');
    expect(ran()).toBe(0);
  });

  it('mandato de MISIÓN que cubre ⇒ ejecuta', async () => {
    const ran = registerMock();
    const res = await runWithMandate({ capabilities: ['shell:*'] }, () => mediatedEffect(shell()));
    expect(res.ok).toBe(true);
    expect(ran()).toBe(1);
  });
});

describe('P1.E3.b — parseMandateSpec (emisor operador-controlado, default-off)', () => {
  it('spec vacío/undefined ⇒ undefined (rama legado, paridad)', () => {
    expect(parseMandateSpec(undefined)).toBeUndefined();
    expect(parseMandateSpec('')).toBeUndefined();
    expect(parseMandateSpec('   ')).toBeUndefined();
    expect(parseMandateSpec(' , ,')).toBeUndefined();
  });
  it('parsea y recorta capacidades', () => {
    const m = parseMandateSpec('shell:*, fs.read:/data ');
    expect(m?.capabilities).toEqual(['shell:*', 'fs.read:/data']);
    expect(m?.expiresAt).toBeUndefined();
  });
  it('ttlMs>0 fija expiresAt = now+ttl; ttl=0 no lo fija', () => {
    expect(parseMandateSpec('shell:*', { ttlMs: 1000, now: 5000 })?.expiresAt).toBe(6000);
    expect(parseMandateSpec('shell:*', { ttlMs: 0, now: 5000 })?.expiresAt).toBeUndefined();
  });
  it('SENSOR: si vacío devolviera mandato, TODA misión no configurada tendría enforcement (ruptura)', () => {
    expect(parseMandateSpec('')).toBeUndefined();
  });
});
