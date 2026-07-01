// Regresión ALTA-18 / MEDIA-14 (auditoría 2026-07-01).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sanitizeToolCallArguments,
  toolCallWasRepaired,
  repairMessageSequence,
  _TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER,
} from '../trajectory_helpers.js';

describe('sanitizeToolCallArguments + toolCallWasRepaired (ALTA-18)', () => {
  it('marca _corruption_marker cuando repara argumentos JSON truncados', () => {
    const truncated = JSON.stringify({
      tool_calls: [{ type: 'function', function: { name: 'run_command', arguments: '"command": "git push --force origin main"' } }],
    });
    const repaired = sanitizeToolCallArguments(truncated);
    const parsed = JSON.parse(repaired);
    expect(toolCallWasRepaired(parsed.tool_calls[0])).toBe(true);
    expect(parsed.tool_calls[0]._corruption_marker).toBe(_TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER);
    // La heurística reconstruyó JSON válido con el comando destructivo intacto.
    expect(JSON.parse(parsed.tool_calls[0].function.arguments).command).toBe('git push --force origin main');
  });

  it('toolCallWasRepaired es false para una tool call cuyos argumentos ya eran JSON válido', () => {
    const clean = JSON.stringify({
      tool_calls: [{ type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }],
    });
    const out = sanitizeToolCallArguments(clean);
    const parsed = JSON.parse(out);
    expect(toolCallWasRepaired(parsed.tool_calls[0])).toBe(false);
  });

  it('toolCallWasRepaired es false/segura ante null, undefined u objetos sin el campo', () => {
    expect(toolCallWasRepaired(null)).toBe(false);
    expect(toolCallWasRepaired(undefined)).toBe(false);
    expect(toolCallWasRepaired({})).toBe(false);
    expect(toolCallWasRepaired({ _corruption_marker: 'algo-distinto' })).toBe(false);
  });

  it('no toca mensajes sin tool_calls', () => {
    const plain = JSON.stringify({ content: 'hola' });
    expect(sanitizeToolCallArguments(plain)).toBe(plain);
  });
});

describe('repairMessageSequence — MEDIA-14: tool message inicial huérfano se loguea', () => {
  afterEach(() => vi.restoreAllMocks());

  it('avisa por consola cuando el primer mensaje es un tool message sin assistant previo', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const messages = [
      { role: 'tool', name: 'read_file', tool_call_id: 'abc123', content: 'huerfano' },
      { role: 'user', content: 'hola' },
    ];
    const out = repairMessageSequence(messages);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('inicial'))).toBe(true);
    expect(out.find((m: any) => m.role === 'tool')).toBeUndefined();
  });
});
