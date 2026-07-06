import { describe, it, expect } from 'vitest';
import { decideAdoption, type AdoptionCandidate } from '../adoption_policy.js';

const base: AdoptionCandidate = {
  name: 'x', description: 'normalizar fechas', certified: true, requestsEffects: false, threatScanClean: true,
};

describe('decideAdoption — puerta de skills en lenguaje llano', () => {
  it('certificada + pura + limpia ⇒ se guarda sola (sin molestar al usuario)', () => {
    const d = decideAdoption(base);
    expect(d.verdict).toBe('auto_keep');
    expect(d.plainMessage).toContain('guardé');
    expect(d.plainMessage).not.toMatch(/skill|pending|approve|frontmatter/i); // nada de jerga
  });

  it('pide efectos ⇒ pregunta en lenguaje normal (no jerga)', () => {
    const d = decideAdoption({ ...base, requestsEffects: true, effectsSummary: 'leer tus archivos' });
    expect(d.verdict).toBe('ask_user');
    expect(d.plainMessage).toContain('leer tus archivos');
    expect(d.plainMessage).toContain('¿La dejo?');
  });

  it('sin certificar ⇒ se descarta (nunca se guarda algo no probado)', () => {
    expect(decideAdoption({ ...base, certified: false }).verdict).toBe('reject');
  });

  it('scanner de amenazas sucio ⇒ se descarta SIEMPRE (fail-closed, aunque esté certificada)', () => {
    const d = decideAdoption({ ...base, threatScanClean: false, certified: true });
    expect(d.verdict).toBe('reject');
    expect(d.reason).toBe('threat_scan_failed');
  });
});
