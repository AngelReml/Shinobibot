// P1.E5 — broker de egress por misión. Bajo un mandato de misión, un HOSTNAME que
// el mandato no concede (net:<host>) se bloquea en el guard ANTES de resolver.
// La decisión pura (egressAllowed) está probada por mutación aparte; esto prueba el
// wiring en el chokepoint DNS. Corre en la suite canónica (Windows).
import { describe, it, expect, afterEach } from 'vitest';
import dns from 'node:dns';
import { installEgressRuntimeGuard, _uninstallEgressRuntimeGuardForTests, EgressBlockedError } from '../runtime_guard.js';
import { runWithMandate } from '../../sandbox/mandate.js';

describe('P1.E5 — broker de egress por misión', () => {
  afterEach(() => _uninstallEgressRuntimeGuardForTests());

  it('bajo mandato, un host NO cubierto se bloquea (EgressBlockedError) antes de resolver', async () => {
    installEgressRuntimeGuard();
    await runWithMandate({ capabilities: ['net:allowed.example'] }, async () => {
      await expect(dns.promises.lookup('blocked.example')).rejects.toBeInstanceOf(EgressBlockedError);
    });
  });

  it('sin mandato de misión, el broker por-misión NO aplica (no bloquea por mandato)', async () => {
    installEgressRuntimeGuard();
    let name = '';
    try { await dns.promises.lookup('nonexistent.invalid'); } catch (e: any) { name = e?.name ?? ''; }
    // debe fallar por resolución real (ENOTFOUND), nunca por mandato
    expect(name).not.toBe('EgressBlockedError');
  });

  it('bajo mandato, un host SÍ cubierto no lo bloquea el mandato (net:* comodín)', async () => {
    installEgressRuntimeGuard();
    let blockedByMandate = false;
    await runWithMandate({ capabilities: ['net:*'] }, async () => {
      try { await dns.promises.lookup('anything.example'); } catch (e: any) { if (e instanceof EgressBlockedError) blockedByMandate = true; }
    });
    expect(blockedByMandate).toBe(false);
  });
});
