// P4 — tests del dry-run. El simulacro debe coincidir con lo que el monitor haría.
import { describe, it, expect } from 'vitest';
import { simulateMission } from '../dryrun.js';

const policy = { default: ['shell:/ws'], profiles: { net: ['shell:/ws', 'net:api.x.com'] } };

describe('P4 — dry-run simulateMission', () => {
  it('marca allow/deny por efecto según el mandato resuelto (sin ejecutar)', () => {
    const sim = simulateMission(policy, {}, [
      { kind: 'shell', scope: '/ws' },
      { kind: 'net', scope: 'api.x.com' },
    ]);
    expect(sim.decisions[0].allowed).toBe(true);
    expect(sim.decisions[1].allowed).toBe(false);
    expect(sim.allAllowed).toBe(false);
  });
  it('con el perfil adecuado, todo permitido', () => {
    const sim = simulateMission(policy, { profile: 'net' }, [{ kind: 'net', scope: 'api.x.com' }]);
    expect(sim.allAllowed).toBe(true);
  });
});
