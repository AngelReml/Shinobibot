/**
 * F5 — tests de las costuras vivas (live/deps.ts), SIN red: los efectos
 * (exec de yt-dlp, caller de tools, llm) se inyectan como fakes. Lo que se
 * verifica es el contrato fail-closed: entrada rara → null/ok:false, nunca
 * contenido fabricado; y que la validación corre ANTES de cualquier subproceso.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidVideoId, parsePrintedField, parseTopComment, pickSearchResult,
  buildLiveResolveDeps, buildLiveFetcher, makeLLMContrastJudge, type ExecYtDlp, type ToolCall,
} from '../live/deps.js';

describe('kagemusha — live/deps (parsers puros)', () => {
  it('isValidVideoId: allowlist estricta antes de armar argv', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidVideoId('corto')).toBe(false);
    expect(isValidVideoId('once_chars!!')).toBe(false);
    expect(isValidVideoId('a; rm -rf ~')).toBe(false);
  });

  it('parsePrintedField: "NA"/vacío → null (hueco honesto)', () => {
    expect(parsePrintedField('  Una descripción real\n')).toBe('Una descripción real');
    expect(parsePrintedField('NA\n')).toBeNull();
    expect(parsePrintedField('')).toBeNull();
  });

  it('parseTopComment: elige el de más likes; JSON raro → null', () => {
    const arr = JSON.stringify([
      { text: 'meh', like_count: 1 },
      { text: 'el bueno con el link', like_count: 99 },
    ]);
    expect(parseTopComment(arr)).toBe('el bueno con el link');
    expect(parseTopComment('NA')).toBeNull();
    expect(parseTopComment('[]')).toBeNull();
    expect(parseTopComment('{no es json')).toBeNull();
  });

  it('pickSearchResult: prioriza tier 2 y filtra el ruido de buscador/plataforma', () => {
    const out = 'resultados: https://www.bing.com/search?q=x luego https://medium.com/post ' +
      'y https://arxiv.org/abs/2401.00001 y https://www.youtube.com/watch?v=abc';
    expect(pickSearchResult(out)).toEqual({ url: 'https://arxiv.org/abs/2401.00001', tier: 2 });
    expect(pickSearchResult('solo ruido https://www.bing.com/x https://youtu.be/abc')).toBeNull();
  });
});

describe('kagemusha — live/deps (resolvers con efectos inyectados)', () => {
  it('getDescription: videoId inválido → null SIN invocar subproceso; válido → parsea y cachea', async () => {
    const calls: string[][] = [];
    const exec: ExecYtDlp = async (argv) => { calls.push(argv); return { ok: true, stdout: 'La descripción con https://arxiv.org/abs/2401.00001\n' }; };
    const deps = buildLiveResolveDeps({ exec });

    expect(await deps.getDescription!('$(evil)')).toBeNull();
    expect(calls.length).toBe(0);                                    // validación ANTES del exec

    const d1 = await deps.getDescription!('dQw4w9WgXcQ');
    const d2 = await deps.getDescription!('dQw4w9WgXcQ');
    expect(d1).toContain('arxiv.org');
    expect(d2).toBe(d1);
    expect(calls.length).toBe(1);                                    // caché por vídeo
    expect(calls[0]).toContain('--skip-download');                   // nunca baja el vídeo
  });

  it('getTopComment: yt-dlp caído → null (hueco honesto, no throw)', async () => {
    const exec: ExecYtDlp = async () => ({ ok: false, stdout: '' });
    const deps = buildLiveResolveDeps({ exec });
    expect(await deps.getTopComment!('dQw4w9WgXcQ')).toBeNull();
  });

  it('webSearch: usa la tool web_search y devuelve la mejor URL tier alto; tool fallida → null', async () => {
    const ok: ToolCall = async (name) => {
      expect(name).toBe('web_search');
      return { success: true, output: 'snippet… https://openreview.net/forum?id=x y https://www.bing.com/y' };
    };
    const deps = buildLiveResolveDeps({ exec: async () => ({ ok: false, stdout: '' }), call: ok });
    expect((await deps.webSearch!('paper Z'))?.url).toBe('https://openreview.net/forum?id=x');

    const broken = buildLiveResolveDeps({ exec: async () => ({ ok: false, stdout: '' }), call: async () => ({ success: false, output: '', error: 'sin browser' }) });
    expect(await broken.webSearch!('paper Z')).toBeNull();
  });

  it('fetcher: clean_extract JSON → texto limpio; fallback a web_search; ambos caídos → ok:false', async () => {
    const viaCleanExtract: ToolCall = async (name) =>
      name === 'clean_extract'
        ? { success: true, output: JSON.stringify({ title: 'Título', content_md: 'Cuerpo del paper', url: 'https://arxiv.org/abs/1' }) }
        : { success: false, output: '' };
    const f1 = buildLiveFetcher({ call: viaCleanExtract });
    const r1 = await f1('https://arxiv.org/abs/1');
    expect(r1.ok).toBe(true);
    expect(r1.text).toContain('Título');
    expect(r1.text).toContain('Cuerpo del paper');

    const viaFallback: ToolCall = async (name) =>
      name === 'web_search' ? { success: true, output: 'texto de la página' } : { success: false, output: '', error: 'CDP caído' };
    const r2 = await buildLiveFetcher({ call: viaFallback })('https://x.test/a');
    expect(r2.ok).toBe(true);
    expect(r2.text).toBe('texto de la página');

    const r3 = await buildLiveFetcher({ call: async () => ({ success: false, output: '', error: 'todo caído' }) })('https://x.test/a');
    expect(r3.ok).toBe(false);
    expect(r3.text).toBe('');                                        // jamás contenido fabricado
  });

  it('makeLLMContrastJudge: JSON válido → veredicto etiquetado; basura/enum inválido/llm caído → null (manda el fallback determinista)', async () => {
    const unit = { unit_id: 'u', path: 'src/x.ts', symbol: 'fn', capability_summary: 'hace x' };

    const good = makeLLMContrastJudge({ llm: async () => ({ ok: true, text: '{"verdict":"MEJOR_QUE_NOSOTROS","rationale":"su poda supera al frontier"}' }) });
    const g = await good('hallazgo', unit, 0.4);
    expect(g?.verdict).toBe('MEJOR_QUE_NOSOTROS');
    expect(g?.rationale).toMatch(/^\[juez llm\]/);

    const garbage = makeLLMContrastJudge({ llm: async () => ({ ok: true, text: 'pues yo creo que sí' }) });
    expect(await garbage('h', unit, 0.4)).toBeNull();

    const badEnum = makeLLMContrastJudge({ llm: async () => ({ ok: true, text: '{"verdict":"REGULAR","rationale":"x"}' }) });
    expect(await badEnum('h', unit, 0.4)).toBeNull();

    const down = makeLLMContrastJudge({ llm: async () => ({ ok: false, text: '', error: 'proveedor caído' }) });
    expect(await down('h', unit, 0.4)).toBeNull();
  });
});
