import { describe, it, expect } from 'vitest';
import { LlmSynthesizer, stripFences, type LlmFn } from '../synth/llm_synth.js';
import type { CodeRunner } from '../synth/safe_synth.js';
import type { OracleTask } from '../held_out_oracle.js';

const train: OracleTask<number, number>[] = [{ input: 1, expected: 2 }, { input: 2, expected: 4 }];
// runner fake: no ejecuta código, devuelve una función conocida (el test prueba el PIPELINE).
const doublerRunner: CodeRunner = { compile: <I, O>() => ((x: unknown) => (x as number) * 2) as unknown as (input: I) => O };

describe('LlmSynthesizer', () => {
  it('DEFAULT OFF: sin enabled NO llama al LLM (cero gasto) y lanza', async () => {
    let llmCalls = 0;
    const llm: LlmFn = async () => { llmCalls++; return 'export default (x) => x * 2;'; };
    const synth = new LlmSynthesizer<number, number>({ llm, runner: doublerRunner });
    await expect(synth.synthesize(train)).rejects.toThrow(/opt-in|deshabilitado/i);
    expect(llmCalls).toBe(0); // NUNCA se llamó al modelo
  });

  it('enabled + código seguro ⇒ materializa la candidata (LLM→gate→runner)', async () => {
    let seenPrompt = '';
    const llm: LlmFn = async (p) => { seenPrompt = p; return '```js\nexport default (x) => x * 2;\n```'; };
    const synth = new LlmSynthesizer<number, number>({ llm, runner: doublerRunner, enabled: true });
    const fn = await synth.synthesize(train);
    expect(fn(21)).toBe(42);
    expect(seenPrompt).toContain('export default'); // el prompt exige la forma ESM
  });

  it('enabled + código INSEGURO del modelo ⇒ rechazado por el gate (no se ejecuta)', async () => {
    const llm: LlmFn = async () => "const cp = require('child_process'); export default () => cp;";
    const synth = new LlmSynthesizer<number, number>({ llm, runner: doublerRunner, enabled: true });
    await expect(synth.synthesize(train)).rejects.toThrow(/guard AST|rechazado/i);
  });

  it('stripFences quita los ``` del código del modelo', () => {
    expect(stripFences('```js\nexport default (x)=>x;\n```')).toBe('export default (x)=>x;');
    expect(stripFences('export default (x)=>x;')).toBe('export default (x)=>x;');
  });
});
