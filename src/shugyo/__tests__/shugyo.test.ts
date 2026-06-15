import { describe, it, expect } from 'vitest';
import { shugyoEnabled } from '../config.js';
import { classifyReversibility, executionPolicy, mayExecute } from '../explore/reversibility.js';
import { parseCliHelp } from '../surface/cli_parser.js';
import { PatternBook, curveIsDescending } from '../curve/patternbook.js';

describe('shugyo — flag', () => {
  it('SHUGYO_ENABLED default off', () => { expect(shugyoEnabled()).toBe(false); });
});

describe('shugyo — reversibility = the anti-destruction mini-boss (§9.2)', () => {
  it('external effects (send/pay/publish) are NEVER executed in exploration', () => {
    expect(classifyReversibility('Send Email')).toBe('external_effect');
    expect(classifyReversibility('--pay invoice')).toBe('external_effect');
    expect(mayExecute('external_effect')).toBe(false);
    expect(executionPolicy('external_effect')).toBe('document_only');
  });
  it('destructive ops are filler_only (revertible cage)', () => {
    expect(classifyReversibility('Delete file')).toBe('destructive');
    expect(classifyReversibility('--format disk')).toBe('destructive');
    expect(executionPolicy('destructive')).toBe('filler_only');
  });
  it('safe ops are freely probed', () => {
    expect(classifyReversibility('--export pdf')).toBe('reversible');
    expect(executionPolicy('reversible')).toBe('probe');
  });
  it('unknown affordances fail-closed (filler_only, not freely probed)', () => {
    expect(classifyReversibility('frobnicate the wibble')).toBe('unknown');
    expect(executionPolicy('unknown')).toBe('filler_only');
  });
});

describe('shugyo — CLI surface parser (§8.1, régimen tratable)', () => {
  it('parses flags and subcommands from help text', () => {
    const help = [
      'usage: tool [options] <command>',
      '',
      'Options:',
      '  -h, --help        show help',
      '  --export <file>   export to a file',
      '  --verbose         verbose output',
      '',
      'Commands:',
      '  convert   convert a file',
      '  list      list items',
    ].join('\n');
    const s = parseCliHelp(help);
    expect(s.flags.find((f) => f.flag === '--export')?.takesArg).toBe(true);
    expect(s.flags.find((f) => f.flag === '--help')?.alias).toBe('-h');
    expect(s.subcommands.map((c) => c.name).sort()).toEqual(['convert', 'list']);
  });
});

describe('shugyo — pattern book / descending curve (§12)', () => {
  it('learns an idiom, matches it by cue in a new app, tracks hit_rate', () => {
    const book = new PatternBook();
    book.learn('export', { cues: ['Export', '--export', 'Save As'], hints: ['File > Export'], seenIn: 'appA' });
    const m = book.match(['save as', 'open']);
    expect(m?.idiom).toBe('export');
    book.recordOutcome('export', true);
    book.recordOutcome('export', true);
    book.recordOutcome('export', false);
    expect(book.get('export')!.hit_rate).toBeCloseTo(2 / 3, 5);
  });
  it('curveIsDescending: cost strictly falls program over program', () => {
    expect(curveIsDescending([100, 70, 40])).toBe(true);
    expect(curveIsDescending([100, 120, 40])).toBe(false);
    expect(curveIsDescending([100])).toBe(false); // need ≥2 to claim a curve
  });
});
