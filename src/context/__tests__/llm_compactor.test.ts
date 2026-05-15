import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveMode, shouldUseLLM, compactWithLLM } from '../llm_compactor.js';

beforeEach(() => { delete process.env.SHINOBI_COMPACTOR_MODE; });
afterEach(() => { delete process.env.SHINOBI_COMPACTOR_MODE; });

describe('resolveMode', () => {
  it('default heuristic', () => {
    expect(resolveMode()).toBe('heuristic');
  });
  it('env var', () => {
    expect(resolveMode('llm')).toBe('llm');
    expect(resolveMode('auto')).toBe('auto');
  });
  it('valor inválido → heuristic', () => {
    expect(resolveMode('garbage' as any)).toBe('heuristic');
  });
  it('override gana sobre env', () => {
    expect(resolveMode('heuristic', 'llm')).toBe('llm');
  });
});

describe('shouldUseLLM', () => {
  const SHORT_MSGS = [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'hi' },
  ];
  // ~32000 tokens estimados (chars/4): 128000 chars
  const LONG_MSGS = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(1300), // 100 msgs * 1300 = 130k chars ≈ 32500 tokens
  }));

  it('heuristic NUNCA usa LLM', () => {
    expect(shouldUseLLM(LONG_MSGS, { mode: 'heuristic' }).useLLM).toBe(false);
  });
  it('llm SIEMPRE', () => {
    expect(shouldUseLLM(SHORT_MSGS, { mode: 'llm' }).useLLM).toBe(true);
  });
  it('auto: corto → false', () => {
    expect(shouldUseLLM(SHORT_MSGS, { mode: 'auto' }).useLLM).toBe(false);
  });
  it('auto: largo → true', () => {
    const r = shouldUseLLM(LONG_MSGS, { mode: 'auto', budgetTokens: 32000, autoThreshold: 0.5 });
    expect(r.useLLM).toBe(true);
    expect(r.estTokens).toBeGreaterThan(16000);
  });
  it('lee env var por default', () => {
    process.env.SHINOBI_COMPACTOR_MODE = 'llm';
    expect(shouldUseLLM(SHORT_MSGS).useLLM).toBe(true);
  });
});

describe('compactWithLLM', () => {
  const MSGS = [
    { role: 'system', content: 'sistema' },
    { role: 'user', content: 'pregunta 1' },
    { role: 'assistant', content: 'respuesta 1' },
    { role: 'user', content: 'pregunta 2' },
    { role: 'assistant', content: 'respuesta 2' },
    { role: 'user', content: 'pregunta 3' },
    { role: 'assistant', content: 'respuesta 3' },
    { role: 'user', content: 'pregunta 4' },
    { role: 'assistant', content: 'respuesta 4' },
    { role: 'user', content: 'pregunta 5' },
    { role: 'assistant', content: 'respuesta 5' },
  ];

  it('sin llmFn → method=skipped con error claro', async () => {
    const r = await compactWithLLM(MSGS);
    expect(r.method).toBe('skipped');
    expect(r.compacted).toBe(false);
    expect(r.error).toContain('llmFn no inyectada');
  });

  it('compacta middle turns y preserva último N', async () => {
    let promptReceived = '';
    const r = await compactWithLLM(MSGS, {
      preserveLastTurns: 2,
      llmFn: async (p) => {
        promptReceived = p;
        return '- Decisión X\n- Hecho Y\n- Tool Z ejecutada';
      },
    });
    expect(r.compacted).toBe(true);
    expect(r.method).toBe('llm');

    // Sistema preservado.
    expect(r.messages[0].role).toBe('system');
    expect(r.messages[0].content).toBe('sistema');

    // Mensaje sintético con summary.
    const synthetic = r.messages.find(m => typeof m.content === 'string' && m.content.includes('compactado-llm'));
    expect(synthetic).toBeTruthy();
    expect(synthetic!.content).toContain('Decisión X');

    // Últimos 2 turnos preservados (turnos 4 y 5).
    const lastBlock = r.messages.slice(-4);
    expect(lastBlock.map(m => m.content)).toEqual(['pregunta 4', 'respuesta 4', 'pregunta 5', 'respuesta 5']);

    // El prompt incluyó los mensajes intermedios.
    expect(promptReceived).toContain('pregunta 1');
    expect(promptReceived).toContain('pregunta 3');
  });

  it('si turnos <= preserveLastTurns → no compacta', async () => {
    const short = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const r = await compactWithLLM(short, { llmFn: async () => 'X', preserveLastTurns: 3 });
    expect(r.compacted).toBe(false);
  });

  it('llmFn que throw → skipped con error', async () => {
    const r = await compactWithLLM(MSGS, {
      llmFn: async () => { throw new Error('rate limit'); },
    });
    expect(r.method).toBe('skipped');
    expect(r.compacted).toBe(false);
    expect(r.error).toContain('rate limit');
  });

  it('afterTokens < beforeTokens cuando comprime', async () => {
    const r = await compactWithLLM(MSGS, {
      preserveLastTurns: 1,
      llmFn: async () => 'tiny summary',
    });
    expect(r.afterTokens).toBeLessThan(r.beforeTokens);
  });

  it('droppedCount = mensajes intermedios eliminados', async () => {
    const r = await compactWithLLM(MSGS, {
      preserveLastTurns: 2,
      llmFn: async () => 'x',
    });
    // 5 turnos - 2 = 3 turnos intermedios = 6 mensajes (3 user + 3 assistant)
    expect(r.droppedCount).toBe(6);
  });
});
