import { describe, it, expect } from 'vitest';
import {
  truncateToolOutput,
  capToolResultJson,
  TOOL_OUTPUT_MAX_CHARS,
} from '../tool_output_truncator.js';

describe('truncateToolOutput', () => {
  it('devuelve el output intacto si está dentro del límite', () => {
    const small = 'x'.repeat(100);
    expect(truncateToolOutput(small)).toBe(small);
  });

  it('trunca un output gigante por debajo del límite', () => {
    const huge = 'a'.repeat(TOOL_OUTPUT_MAX_CHARS + 10_000);
    const result = truncateToolOutput(huge);
    expect(result.length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS + 200); // marker overhead
    expect(result.length).toBeLessThan(huge.length);
  });

  it('el output truncado contiene el marker de truncado', () => {
    const huge = 'B'.repeat(TOOL_OUTPUT_MAX_CHARS * 2);
    const result = truncateToolOutput(huge);
    expect(result).toContain('contenido truncado');
    expect(result).toContain('read_file');
    expect(result).toContain('startLine/endLine');
  });

  it('conserva el principio y el final del output', () => {
    const head = 'HEAD_CONTENT_START ';
    const tail = ' TAIL_CONTENT_END';
    const middle = 'M'.repeat(TOOL_OUTPUT_MAX_CHARS * 2);
    const huge = head + middle + tail;
    const result = truncateToolOutput(huge);
    expect(result.startsWith(head)).toBe(true);
    expect(result.endsWith(tail)).toBe(true);
  });

  it('respeta un límite personalizado', () => {
    const input = 'x'.repeat(2000);
    const result = truncateToolOutput(input, 1000);
    expect(result.length).toBeLessThan(input.length);
    expect(result).toContain('contenido truncado');
  });

  it('no altera strings vacíos o nulos', () => {
    expect(truncateToolOutput('')).toBe('');
    expect(truncateToolOutput(null as any)).toBe(null);
  });
});

describe('capToolResultJson', () => {
  it('devuelve intacto si el JSON está dentro del límite', () => {
    const small = JSON.stringify({ success: true, output: 'ok' });
    const { result, truncated } = capToolResultJson(small);
    expect(truncated).toBe(false);
    expect(result).toBe(small);
  });

  it('trunca el campo output del JSON si es demasiado grande', () => {
    const bigOutput = 'L'.repeat(TOOL_OUTPUT_MAX_CHARS + 5_000);
    const json = JSON.stringify({ success: true, output: bigOutput });
    const { result, truncated } = capToolResultJson(json);
    expect(truncated).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.output.length).toBeLessThan(bigOutput.length);
    expect(parsed.output).toContain('contenido truncado');
    expect(parsed.success).toBe(true); // otros campos intactos
  });

  it('el JSON resultante sigue siendo parseable', () => {
    const bigOutput = 'Z'.repeat(TOOL_OUTPUT_MAX_CHARS * 2);
    const json = JSON.stringify({ success: true, output: bigOutput, error: undefined });
    const { result } = capToolResultJson(json);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('output resultante queda por debajo del cap', () => {
    const bigOutput = 'Q'.repeat(TOOL_OUTPUT_MAX_CHARS * 3);
    const json = JSON.stringify({ success: true, output: bigOutput });
    const { result } = capToolResultJson(json);
    const parsed = JSON.parse(result);
    expect(parsed.output.length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS + 300);
  });
});
