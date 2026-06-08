// src/agents/__tests__/agent_loop.test.ts
//
// Tests del CIMIENTO multi-agente. Deterministas: el LLM se inyecta (sin red)
// y el audit se desactiva para no escribir audit.jsonl durante los tests.
// Cubre: cierre conversacional, ejecución de tool, mínimo privilegio (caja
// cerrada), profundidad de spawn, tope de iteraciones, las tres capas del loop
// detector heredadas, y errores de LLM.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAgentLoop, type LLMInvoker } from '../agent_loop.js';
import { registerTool, unregisterTool, type Tool } from '../../tools/tool_registry.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function toolCall(name: string, args: unknown, id = 'c1') {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** Invocador que devuelve respuestas pre-escritas en orden (repite la última). */
function scripted(responses: Array<{ content?: string; tool_calls?: any[] } | { __error: string } | { __throw: string }>): LLMInvoker {
  let i = 0;
  return async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if ((r as any).__throw) throw new Error((r as any).__throw);
    if ((r as any).__error) return { success: false, output: '', error: (r as any).__error };
    return { success: true, output: JSON.stringify(r), error: '' };
  };
}

// Estado observable de las tools mock.
let echoCalls: any[] = [];
let forbiddenCalls = 0;

const echoTool: Tool = {
  name: 'mock_echo',
  description: 'Devuelve sus argumentos.',
  parameters: { type: 'object', properties: {} },
  async execute(args: any) {
    echoCalls.push(args);
    return { success: true, output: 'echo:' + JSON.stringify(args) };
  },
};

const forbiddenTool: Tool = {
  name: 'forbidden_tool',
  description: 'No debería ejecutarse nunca fuera de su caja.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    forbiddenCalls++;
    return { success: true, output: 'EJECUTADA (no debería)' };
  },
};

const failTool: Tool = {
  name: 'mock_fail',
  description: 'Falla siempre por la MISMA causa de entorno (browser caído), con output distinto.',
  parameters: { type: 'object', properties: {} },
  async execute(args: any) {
    // Output DISTINTO cada vez (incluye los args) para no disparar la capa 2
    // (output repetido), pero MISMA causa de entorno → clasifica
    // browser_unavailable y debe dispararse la capa 3.
    return { success: false, output: '', error: `No browser on port 9222 (intento ${JSON.stringify(args)})` };
  },
};

beforeAll(() => {
  process.env.SHINOBI_AUDIT_DISABLED = '1';
});
afterAll(() => {
  delete process.env.SHINOBI_AUDIT_DISABLED;
});

beforeEach(() => {
  echoCalls = [];
  forbiddenCalls = 0;
  registerTool(echoTool);
  registerTool(forbiddenTool);
  registerTool(failTool);
});
afterEach(() => {
  unregisterTool('mock_echo');
  unregisterTool('forbidden_tool');
  unregisterTool('mock_fail');
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('agent_loop — cimiento multi-agente', () => {
  it('cierra conversacional cuando el LLM responde texto sin tools', async () => {
    const res = await runAgentLoop({
      task: 'di hola',
      systemPrompt: 'eres un agente de prueba',
      tools: [],
      invokeLLM: scripted([{ content: 'hola' }]),
    });
    expect(res.ok).toBe(true);
    expect(res.verdict).toBe('COMPLETED');
    expect(res.output).toBe('hola');
    expect(res.iterations).toBe(1);
    expect(res.toolsUsed).toEqual([]);
  });

  it('ejecuta una tool permitida y luego cierra', async () => {
    const res = await runAgentLoop({
      task: 'usa la tool',
      systemPrompt: 'agente',
      tools: ['mock_echo'],
      invokeLLM: scripted([
        { content: '', tool_calls: [toolCall('mock_echo', { x: 1 })] },
        { content: 'listo' },
      ]),
    });
    expect(res.verdict).toBe('COMPLETED');
    expect(res.output).toBe('listo');
    expect(res.toolsUsed).toEqual(['mock_echo']);
    expect(echoCalls).toEqual([{ x: 1 }]);
    expect(res.iterations).toBe(2);
  });

  it('mínimo privilegio: deniega una tool fuera de la caja sin ejecutarla', async () => {
    const res = await runAgentLoop({
      task: 'intenta algo prohibido',
      systemPrompt: 'agente',
      tools: ['mock_echo'], // forbidden_tool NO está en la caja
      invokeLLM: scripted([
        { content: '', tool_calls: [toolCall('forbidden_tool', { danger: true })] },
        { content: 'me adapté' },
      ]),
    });
    expect(res.verdict).toBe('COMPLETED');
    expect(forbiddenCalls).toBe(0); // jamás se ejecutó
    expect(res.toolsUsed).toEqual([]); // no cuenta como tool usada
    expect(res.output).toBe('me adapté');
  });

  it('aborta por profundidad de spawn alcanzada sin llamar al LLM', async () => {
    let called = 0;
    const res = await runAgentLoop({
      task: 't',
      systemPrompt: 's',
      tools: [],
      depth: 3,
      maxDepth: 3,
      invokeLLM: async () => { called++; return { success: true, output: '{}', error: '' }; },
    });
    expect(res.verdict).toBe('DEPTH_EXCEEDED');
    expect(res.ok).toBe(false);
    expect(res.iterations).toBe(0);
    expect(called).toBe(0);
  });

  it('respeta el tope de iteraciones (args únicos por turno, sin falso loop)', async () => {
    let n = 0;
    const invoke: LLMInvoker = async () => {
      n++;
      return {
        success: true,
        output: JSON.stringify({ content: '', tool_calls: [toolCall('mock_echo', { n }, 'c' + n)] }),
        error: '',
      };
    };
    const res = await runAgentLoop({
      task: 'bucle infinito controlado',
      systemPrompt: 'agente',
      tools: ['mock_echo'],
      maxIterations: 3,
      invokeLLM: invoke,
    });
    expect(res.verdict).toBe('MAX_ITERATIONS');
    expect(res.iterations).toBe(3);
    expect(res.toolsUsed).toEqual(['mock_echo', 'mock_echo', 'mock_echo']);
  });

  it('hereda la capa 1 del loop detector: misma tool+args repetida aborta', async () => {
    const res = await runAgentLoop({
      task: 'repite',
      systemPrompt: 'agente',
      tools: ['mock_echo'],
      invokeLLM: scripted([
        { content: '', tool_calls: [toolCall('mock_echo', { same: 1 })] },
        { content: '', tool_calls: [toolCall('mock_echo', { same: 1 })] },
      ]),
    });
    expect(res.verdict).toBe('LOOP_DETECTED');
    expect(res.toolsUsed).toEqual(['mock_echo']); // solo el primer intento se ejecutó
    expect(echoCalls.length).toBe(1);
  });

  it('hereda la capa 3 del loop detector: fallos de entorno repetidos abortan', async () => {
    // mock_fail siempre falla con "browser caído" → modo browser_unavailable.
    // El acumulativo (default 3) dispara LOOP_SAME_FAILURE. Args distintos cada
    // vez para no chocar antes con la capa 1.
    let n = 0;
    const invoke: LLMInvoker = async () => {
      n++;
      return {
        success: true,
        output: JSON.stringify({ content: '', tool_calls: [toolCall('mock_fail', { n }, 'f' + n)] }),
        error: '',
      };
    };
    const res = await runAgentLoop({
      task: 'algo que necesita browser',
      systemPrompt: 'agente',
      tools: ['mock_fail'],
      maxIterations: 10,
      invokeLLM: invoke,
    });
    expect(res.verdict).toBe('LOOP_SAME_FAILURE');
    expect(res.error).toMatch(/entorno|browser/i);
  });

  it('traduce un fallo de LLM a verdict ERROR (no lanza)', async () => {
    const res = await runAgentLoop({
      task: 't', systemPrompt: 's', tools: [],
      invokeLLM: scripted([{ __error: 'rate limited' }]),
    });
    expect(res.verdict).toBe('ERROR');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rate limited/);
  });

  it('traduce una excepción del LLM a verdict ERROR (no propaga)', async () => {
    const res = await runAgentLoop({
      task: 't', systemPrompt: 's', tools: [],
      invokeLLM: scripted([{ __throw: 'boom' }]),
    });
    expect(res.verdict).toBe('ERROR');
    expect(res.error).toMatch(/boom/);
  });

  it('approvalGate deniega → la tool NO se ejecuta (gate selectivo)', async () => {
    const res = await runAgentLoop({
      task: 'usa la tool', systemPrompt: 'agente', tools: ['mock_echo'],
      invokeLLM: scripted([
        { content: '', tool_calls: [toolCall('mock_echo', { x: 1 })] },
        { content: 'me adapté' },
      ]),
      approvalGate: async () => false,
    });
    expect(res.verdict).toBe('COMPLETED');
    expect(echoCalls.length).toBe(0); // gate la frenó
    expect(res.toolsUsed).toEqual([]);
  });

  it('approvalGate permite → la tool se ejecuta', async () => {
    const res = await runAgentLoop({
      task: 'usa la tool', systemPrompt: 'agente', tools: ['mock_echo'],
      invokeLLM: scripted([
        { content: '', tool_calls: [toolCall('mock_echo', { x: 2 })] },
        { content: 'hecho' },
      ]),
      approvalGate: async () => true,
    });
    expect(res.toolsUsed).toEqual(['mock_echo']);
    expect(echoCalls).toEqual([{ x: 2 }]);
  });

  it('trata texto plano del provider como respuesta final (parseo defensivo)', async () => {
    // Provider devuelve texto plano, no JSON de message.
    const invoke: LLMInvoker = async () => ({ success: true, output: 'respuesta directa', error: '' });
    const res = await runAgentLoop({
      task: 't', systemPrompt: 's', tools: [], invokeLLM: invoke,
    });
    expect(res.verdict).toBe('COMPLETED');
    expect(res.output).toBe('respuesta directa');
  });
});
