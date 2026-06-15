import { describe, it, expect } from 'vitest';
import { listExportedSymbols, buildCodebaseIndex } from '../contrast/codebase_index.js';
import { mapFindingToModule } from '../contrast/contrast.js';
import type { CodebaseUnit } from '../types.js';

describe('C-14 — codebase symbol index (NEW; LSP only had diagnostics)', () => {
  it('lists exported functions/classes/interfaces/consts', () => {
    const src = [
      'export function shouldExpand() {}',
      'export class Frontier {}',
      'export interface FrontierItem {}',
      'export const MAX = 8;',
      'function private_helper() {}',   // not exported → ignored
    ].join('\n');
    const syms = listExportedSymbols(src);
    expect(syms.map((s) => s.symbol).sort()).toEqual(['Frontier', 'FrontierItem', 'MAX', 'shouldExpand']);
    expect(syms.find((s) => s.symbol === 'Frontier')!.kind).toBe('class');
  });
  it('buildCodebaseIndex produces units with a capability_summary', () => {
    const units = buildCodebaseIndex([{ path: 'src/kagemusha/thread/frontier.ts', content: 'export function shouldExpand() {}' }]);
    expect(units.length).toBe(1);
    expect(units[0].path).toBe('src/kagemusha/thread/frontier.ts');
    expect(units[0].capability_summary).toContain('shouldExpand');
  });
});

describe('C-15 — map finding → module + ContrastVerdict (§9.2)', () => {
  const units: CodebaseUnit[] = [
    { unit_id: '1', path: 'src/kagemusha/thread/frontier.ts', symbol: 'shouldExpand', capability_summary: 'frontier priority queue pruning budget anti-cycle for recursive thread expansion' },
    { unit_id: '2', path: 'src/integrity/checks.ts', symbol: 'check11_2', capability_summary: 'integrity check action within declared effects enforcement' },
  ];
  it('a finding about frontier pruning maps to the frontier module', () => {
    const v = mapFindingToModule('f1', 'a new technique for frontier pruning in recursive expansion with a priority queue', units);
    expect(v.codebase_unit).toBe('src/kagemusha/thread/frontier.ts');
    expect(['YA_LO_TENEMOS', 'SIRVE']).toContain(v.verdict);
  });
  it('an unrelated finding is IRRELEVANTE', () => {
    const v = mapFindingToModule('f2', 'gluten-free sourdough bread baking schedule', units);
    expect(v.verdict).toBe('IRRELEVANTE');
  });
  it('an injectable judge gets the final SIRVE/YA/MEJOR call', () => {
    const v = mapFindingToModule('f3', 'frontier pruning priority queue', units, {
      judge: () => ({ verdict: 'MEJOR_QUE_NOSOTROS', rationale: 'theirs is provably optimal' }),
    });
    expect(v.verdict).toBe('MEJOR_QUE_NOSOTROS');
    expect(v.codebase_unit).toBe('src/kagemusha/thread/frontier.ts');
  });
});
