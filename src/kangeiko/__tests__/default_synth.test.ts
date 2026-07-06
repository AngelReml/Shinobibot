// Regresión del bug real encontrado verificando end-to-end en Windows con un LLM
// real (OpenRouter): invokeLLM().output NO es texto plano — es el mensaje
// OpenAI-compatible (a veces JSON-stringificado). providerLlm() lo pasaba tal
// cual como "código" a scanForbidden/isolated-vm, que siempre rompía al parsear
// (`Unexpected token ':'` en el primer `"role":`) — la ruta real de síntesis
// NUNCA certificaba nada. Fix: reutiliza extractContent (swarm_orchestrator.ts).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { synthEnabled, providerLlm, createDefaultSynthesizer } from '../synth/default_synth.js';

vi.mock('../../providers/provider_router.js', () => ({ invokeLLM: vi.fn() }));

describe('synthEnabled — opt-in, default OFF', () => {
  afterEach(() => { delete process.env.SHINOBI_SYNTH_LLM; });
  it('false sin la env var', () => { delete process.env.SHINOBI_SYNTH_LLM; expect(synthEnabled()).toBe(false); });
  it('true con SHINOBI_SYNTH_LLM=1', () => { process.env.SHINOBI_SYNTH_LLM = '1'; expect(synthEnabled()).toBe(true); });
});

describe('providerLlm — extrae el código real del mensaje del LLM (regresión)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('output JSON-stringificado (caso real observado con OpenRouter) ⇒ devuelve SOLO el content, no el JSON entero', async () => {
    const { invokeLLM } = await import('../../providers/provider_router.js');
    (invokeLLM as any).mockResolvedValue({
      success: true,
      output: JSON.stringify({ role: 'assistant', content: '```javascript\nexport default (input) => input * 2\n```', refusal: null }),
    });
    const code = await providerLlm('cualquier prompt');
    expect(code).toBe('```javascript\nexport default (input) => input * 2\n```');
    expect(code).not.toContain('"role"'); // el bug: antes se devolvía el JSON completo
  });

  it('output ya como objeto (no string) ⇒ misma extracción', async () => {
    const { invokeLLM } = await import('../../providers/provider_router.js');
    (invokeLLM as any).mockResolvedValue({ success: true, output: { role: 'assistant', content: 'export default (x) => x;' } as any });
    const code = await providerLlm('p');
    expect(code).toBe('export default (x) => x;');
  });

  it('output texto plano (sin envoltorio) ⇒ se devuelve tal cual', async () => {
    const { invokeLLM } = await import('../../providers/provider_router.js');
    (invokeLLM as any).mockResolvedValue({ success: true, output: 'export default (x) => x;' });
    const code = await providerLlm('p');
    expect(code).toBe('export default (x) => x;');
  });

  it('invokeLLM falla ⇒ lanza (no sintetiza a partir de un error)', async () => {
    const { invokeLLM } = await import('../../providers/provider_router.js');
    (invokeLLM as any).mockResolvedValue({ success: false, output: '', error: 'rate limit' });
    await expect(providerLlm('p')).rejects.toThrow(/rate limit/);
  });
});

describe('createDefaultSynthesizer', () => {
  it('sin flag: el AsyncSynthesizer devuelto rechaza sin llamar a nada (cero gasto)', async () => {
    delete process.env.SHINOBI_SYNTH_LLM;
    const synth = createDefaultSynthesizer<number, number>();
    await expect(synth.synthesize([{ input: 1, expected: 2 }])).rejects.toThrow(/opt-in|deshabilitado/i);
  });
});
