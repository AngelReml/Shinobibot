// P3 — tests del manifiesto. Mutación: parseManifest que NO descarta capacidades
// malformadas → el test de fail-closed se pone rojo. Regla #2, evidencia en DECISIONES.
import { describe, it, expect } from 'vitest';
import { parseManifest, manifestToMandate } from '../manifest.js';

describe('P3 — manifiesto de capacidades', () => {
  it('parsea capacidades válidas y descarta malformadas (fail-closed)', () => {
    const m = parseManifest({ name: 'skill-x', capabilities: ['net:api.x.com', 'fs.read:./data', 'BASURA', 'shell', 42] });
    expect(m).not.toBeNull();
    expect(m!.capabilities).toEqual(['net:api.x.com', 'fs.read:./data']);
  });
  it('rechaza manifiestos sin nombre o sin lista de capacidades', () => {
    expect(parseManifest({ capabilities: [] })).toBeNull();
    expect(parseManifest({ name: 'x' })).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });
  it('el manifiesto ES el mandato (misma gramática); ttl ⇒ expiresAt', () => {
    const man = { name: 's', capabilities: ['net:api.x.com'] };
    expect(manifestToMandate(man).capabilities).toEqual(['net:api.x.com']);
    expect(manifestToMandate(man, 1000, 5000).expiresAt).toBe(6000);
  });
});
