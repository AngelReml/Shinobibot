// src/audit/__tests__/audit_chain.test.ts
//
// Tests del motor E7 (cadena de hashes del audit). Puro y determinista.

import { describe, it, expect } from 'vitest';
import { buildChain, chainRoot, verifyChain, hashLine, toLines } from '../audit_chain.js';

const sample = [
  '{"kind":"tool_call","tool":"read_file","success":true}',
  '{"kind":"tool_call","tool":"write_file","success":true}',
  '{"kind":"loop_abort","tool":"x","verdict":"LOOP_DETECTED"}',
  '{"kind":"failover","from":"groq","to":"openai"}',
];

describe('audit_chain — cadena de hashes', () => {
  it('encadena: cada chainHash depende del anterior', () => {
    const chain = buildChain(sample);
    expect(chain).toHaveLength(4);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prevHash).toBe(chain[i - 1].chainHash);
    }
  });

  it('la raíz es estable y reproducible', () => {
    expect(chainRoot(sample)).toBe(chainRoot(sample));
    expect(chainRoot(sample)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifica una cadena íntegra contra su referencia', () => {
    const ref = buildChain(sample);
    expect(verifyChain(sample, { entries: ref }).valid).toBe(true);
  });

  it('manipular una línea rompe la cadena EXACTAMENTE en su índice', () => {
    const ref = buildChain(sample);
    const tampered = sample.slice();
    tampered[2] = tampered[2].replace('LOOP_DETECTED', 'LOOP_HIDDEN');
    const v = verifyChain(tampered, { entries: ref });
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(2);
    expect(v.reason).toBe('tampered_line');
  });

  it('insertar/borrar una línea se detecta por longitud', () => {
    const ref = buildChain(sample);
    expect(verifyChain(sample.slice(0, 3), { entries: ref }).valid).toBe(false);
    expect(verifyChain([...sample, '{"kind":"tool_call","tool":"z","success":true}'], { entries: ref }).reason).toBe('length_mismatch');
  });

  it('verifica también contra una raíz esperada', () => {
    const root = chainRoot(sample);
    expect(verifyChain(sample, { expectedRoot: root }).valid).toBe(true);
    expect(verifyChain([...sample, 'extra'], { expectedRoot: root }).reason).toBe('root_mismatch');
  });

  it('toLines ignora líneas vacías y CRLF', () => {
    expect(toLines('a\r\n\nb\n')).toEqual(['a', 'b']);
    expect(hashLine('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
