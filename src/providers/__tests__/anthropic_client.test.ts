import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  anthropicClient,
  applyPromptCaching,
  anthropicKeys,
  cachingEnabled,
  _resetKeyPoolForTests,
  setReasoningLevel, reasoningLevel, reasoningBudget, parseReasoningLevel, stripThinking,
} from '../anthropic_client.js';
import { calculateCost } from '../../coordinator/orchestrator.js';

vi.mock('axios');
const post = vi.mocked(axios.post);

const OK = (usage: any = { input_tokens: 10, output_tokens: 5 }) => ({
  status: 200,
  data: { content: [{ type: 'text', text: 'hola' }], usage },
});
const httpError = (status: number, message?: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: message ? { error: { message } } : {} },
  });

const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'lee', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'write_file', description: 'escribe', parameters: { type: 'object', properties: {} } } },
];
const MESSAGES = [
  { role: 'system', content: 'Eres Shinobi.' },
  { role: 'user', content: 'lee el fichero' },
  { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
  { role: 'tool', tool_call_id: 't1', content: 'contenido del fichero' },
];

const countMarks = (body: any): number => JSON.stringify(body).split('"cache_control"').length - 1;

describe('anthropic_client — caché de prompt, límites y pool de claves', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    post.mockReset();
    _resetKeyPoolForTests();
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEYS', 'SHINOBI_PROVIDER_KEY', 'SHINOBI_ANTHROPIC_CACHE',
      'SHINOBI_ANTHROPIC_MAX_TOKENS', 'SHINOBI_LLM_TIMEOUT_MS', 'SHINOBI_MODEL_DEFAULT']) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = 'k1';
  });
  afterEach(() => { process.env = { ...saved }; });

  it('marca tools, system y los dos últimos mensajes, sin pasar de 4 puntos de caché', async () => {
    post.mockResolvedValue(OK());
    const res = await anthropicClient.invokeLLM({ messages: MESSAGES, tools: TOOLS });
    expect(res.success).toBe(true);
    const body: any = post.mock.calls[0][1];
    expect(body.system).toEqual([{ type: 'text', text: 'Eres Shinobi.', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    // último mensaje = tool_result (user); penúltimo = assistant con tool_use
    const last = body.messages[body.messages.length - 1];
    const prev = body.messages[body.messages.length - 2];
    expect(last.content[last.content.length - 1]).toMatchObject({ type: 'tool_result', cache_control: { type: 'ephemeral' } });
    expect(prev.content[prev.content.length - 1]).toMatchObject({ type: 'tool_use', cache_control: { type: 'ephemeral' } });
    expect(countMarks(body)).toBe(4);
  });

  it('no muta el payload del llamador', async () => {
    post.mockResolvedValue(OK());
    const before = JSON.stringify({ MESSAGES, TOOLS });
    await anthropicClient.invokeLLM({ messages: MESSAGES, tools: TOOLS });
    expect(JSON.stringify({ MESSAGES, TOOLS })).toBe(before);
  });

  it('no marca mensajes de texto vacío (Anthropic los rechaza) y busca el anterior', () => {
    const out = applyPromptCaching('s', undefined, [
      { role: 'user', content: 'uno' },
      { role: 'assistant', content: 'dos' },
      { role: 'user', content: '   ' },
    ]);
    expect(out.messages[2].content).toBe('   ');
    expect(out.messages[1].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(out.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('SHINOBI_ANTHROPIC_CACHE=0 envía el cuerpo de siempre, sin ningún punto de caché', async () => {
    process.env.SHINOBI_ANTHROPIC_CACHE = '0';
    expect(cachingEnabled()).toBe(false);
    post.mockResolvedValue(OK());
    await anthropicClient.invokeLLM({ messages: MESSAGES, tools: TOOLS });
    const body: any = post.mock.calls[0][1];
    expect(body.system).toBe('Eres Shinobi.');
    expect(countMarks(body)).toBe(0);
  });

  it('suma lo cacheado al prompt y lo expone aparte', async () => {
    post.mockResolvedValue(OK({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 }));
    const res = await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(res.usage).toEqual({ prompt_tokens: 5400, completion_tokens: 20, total_tokens: 5420, cache_read_tokens: 5000, cache_write_tokens: 300 });
  });

  it('el coste descuenta lo leído de caché y recarga lo escrito', () => {
    const sin = calculateCost('anthropic', 'claude-haiku-4-5', { prompt_tokens: 1_000_000, completion_tokens: 0 });
    const leido = calculateCost('anthropic', 'claude-haiku-4-5', { prompt_tokens: 1_000_000, completion_tokens: 0, cache_read_tokens: 1_000_000 });
    const escrito = calculateCost('anthropic', 'claude-haiku-4-5', { prompt_tokens: 1_000_000, completion_tokens: 0, cache_write_tokens: 1_000_000 });
    expect(leido).toBeCloseTo(sin * 0.1, 6);
    expect(escrito).toBeCloseTo(sin * 1.25, 6);
  });

  it('por defecto pide respuestas de 8192 tokens y espera 180 s; ambos siguen siendo configurables', async () => {
    post.mockResolvedValue(OK());
    await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect((post.mock.calls[0][1] as any).max_tokens).toBe(8192);
    expect((post.mock.calls[0][2] as any).timeout).toBe(180000);
    process.env.SHINOBI_ANTHROPIC_MAX_TOKENS = '1000';
    process.env.SHINOBI_LLM_TIMEOUT_MS = '5000';
    await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect((post.mock.calls[1][1] as any).max_tokens).toBe(1000);
    expect((post.mock.calls[1][2] as any).timeout).toBe(5000);
  });

  it('pool: ante 429 prueba la siguiente clave y se queda con la que funciona', async () => {
    process.env.ANTHROPIC_API_KEYS = 'k2, k3';
    expect(anthropicKeys()).toEqual(['k1', 'k2', 'k3']);
    post.mockRejectedValueOnce(httpError(429, 'rate limit')).mockResolvedValue(OK());
    const r1 = await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(r1.success).toBe(true);
    expect((post.mock.calls[0][2] as any).headers['x-api-key']).toBe('k1');
    expect((post.mock.calls[1][2] as any).headers['x-api-key']).toBe('k2');
    await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect((post.mock.calls[2][2] as any).headers['x-api-key']).toBe('k2');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('pool: si todas fallan devuelve el último error y prueba cada clave una sola vez', async () => {
    process.env.ANTHROPIC_API_KEYS = 'k2';
    post.mockRejectedValue(httpError(401));
    const r = await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Anthropic HTTP 401: key inválida.');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('un error que no es de clave (400) no rota: cambiar de clave daría lo mismo', async () => {
    process.env.ANTHROPIC_API_KEYS = 'k2';
    post.mockRejectedValue(httpError(400, 'messages: bad shape'));
    const r = await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(r.error).toBe('Anthropic: messages: bad shape');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('con una sola clave y sin pool se comporta como antes; sin claves, error claro sin llamar', async () => {
    post.mockResolvedValue(OK());
    await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(post).toHaveBeenCalledTimes(1);
    delete process.env.ANTHROPIC_API_KEY;
    post.mockReset();
    const r = await anthropicClient.invokeLLM({ messages: MESSAGES });
    expect(r.success).toBe(false);
    expect(post).not.toHaveBeenCalled();
    process.env.SHINOBI_PROVIDER_KEY = 'generica';
    expect(anthropicKeys()).toEqual(['generica']);
  });

  describe('modo de razonamiento', () => {
    beforeEach(() => { setReasoningLevel(null); delete process.env.SHINOBI_REASONING; });
    afterEach(() => { setReasoningLevel(null); delete process.env.SHINOBI_REASONING; });

    it('apagado por defecto: la petición no lleva thinking y conserva la temperatura', async () => {
      post.mockResolvedValue(OK());
      await anthropicClient.invokeLLM({ messages: MESSAGES, temperature: 0.3 });
      const body: any = post.mock.calls[0][1];
      expect(body.thinking).toBeUndefined();
      expect(body.temperature).toBe(0.3);
      expect(reasoningLevel()).toBe('off');
    });

    it('niveles: env y /reasoning, con el override por delante', () => {
      expect(parseReasoningLevel('ALTO')).toBe('high');
      expect(parseReasoningLevel('medio')).toBe('medium');
      expect(parseReasoningLevel('off')).toBe('off');
      expect(parseReasoningLevel('turbo')).toBeNull();
      process.env.SHINOBI_REASONING = 'low';
      expect(reasoningBudget()).toBe(2000);
      setReasoningLevel('high');
      expect(reasoningBudget()).toBe(16000);
      setReasoningLevel('off');
      expect(reasoningBudget()).toBe(0);
    });

    it('activo: manda presupuesto, quita la temperatura y deja margen de salida por encima del presupuesto', async () => {
      setReasoningLevel('medium');
      post.mockResolvedValue(OK());
      await anthropicClient.invokeLLM({ messages: MESSAGES, temperature: 0.3, max_tokens: 1000 });
      const body: any = post.mock.calls[0][1];
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBeGreaterThan(8000);
    });

    it('guarda los bloques de pensamiento junto a un tool_use y los devuelve intactos y en primer lugar', async () => {
      setReasoningLevel('low');
      const think = { type: 'thinking', thinking: 'veamos…', signature: 'sig123' };
      post.mockResolvedValueOnce({ status: 200, data: { content: [think, { type: 'tool_use', id: 't9', name: 'read_file', input: { path: 'a' } }], usage: { input_tokens: 1, output_tokens: 1 } } });
      const r = await anthropicClient.invokeLLM({ messages: MESSAGES, tools: TOOLS });
      const msg = JSON.parse(r.output);
      expect(msg._anthropic_thinking).toEqual([think]);
      post.mockResolvedValueOnce(OK());
      await anthropicClient.invokeLLM({ tools: TOOLS, messages: [...MESSAGES, msg, { role: 'tool', tool_call_id: 't9', content: 'ok' }] });
      const sent: any = post.mock.calls[1][1];
      const assistant = sent.messages.filter((m: any) => m.role === 'assistant').pop();
      expect(assistant.content[0]).toEqual(think);
      expect(assistant.content[1].type).toBe('tool_use');
    });

    it('apagado: los bloques de pensamiento guardados no se envían', async () => {
      const think = { type: 'thinking', thinking: 'x', signature: 's' };
      post.mockResolvedValue(OK());
      await anthropicClient.invokeLLM({ tools: TOOLS, messages: [
        MESSAGES[0], MESSAGES[1],
        { ...MESSAGES[2], _anthropic_thinking: [think] } as any, MESSAGES[3],
      ] });
      expect(JSON.stringify(post.mock.calls[0][1])).not.toContain('"thinking"');
      expect(stripThinking([{ role: 'assistant', content: [think, { type: 'text', text: 'a' }] }])[0].content).toEqual([{ type: 'text', text: 'a' }]);
    });

    it('si la API rechaza el razonamiento, reintenta una sola vez sin él', async () => {
      setReasoningLevel('high');
      post.mockRejectedValueOnce(httpError(400, 'thinking: this model does not support extended thinking'));
      post.mockResolvedValueOnce(OK());
      const r = await anthropicClient.invokeLLM({ messages: MESSAGES });
      expect(r.success).toBe(true);
      expect(post).toHaveBeenCalledTimes(2);
      expect((post.mock.calls[1][1] as any).thinking).toBeUndefined();
      post.mockReset();
      post.mockRejectedValue(httpError(400, 'thinking: nope'));
      const bad = await anthropicClient.invokeLLM({ messages: MESSAGES });
      expect(bad.success).toBe(false);
      expect(post).toHaveBeenCalledTimes(2);
    });
  });
});
