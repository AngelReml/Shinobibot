/**
 * Tests puros para voice_speak y audio_transcribe.
 *
 * No ejecutamos voice_speak realmente (haría ruido en CI). No llamamos a
 * Whisper API (requeriría OPENAI_API_KEY + audio real). Solo verificamos:
 *   - registro en el tool registry
 *   - schema válido
 *   - validaciones tempranas (key faltante, archivo no existe, extensión
 *     no soportada, tamaño excedido)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTool } from '../tool_registry.js';
import '../voice_speak.js';
import '../audio_transcribe.js';
import { SUPPORTED_EXTENSIONS, MAX_SIZE_BYTES } from '../audio_transcribe.js';

describe('voice_speak tool', () => {
  it('registrado con schema válido', () => {
    const t = getTool('voice_speak')!;
    expect(t).toBeTruthy();
    expect(t.parameters.required).toEqual(['text']);
    expect(t.parameters.properties.text).toBeTruthy();
    expect(t.parameters.properties.voice).toBeTruthy();
    expect(t.parameters.properties.rate).toBeTruthy();
  });

  it('rechaza text vacío sin ejecutar PowerShell', async () => {
    const t = getTool('voice_speak')!;
    const r = await t.execute({ text: '' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('vacío');
  });

  it('rechaza text con solo whitespace', async () => {
    const t = getTool('voice_speak')!;
    const r = await t.execute({ text: '   \n\t  ' });
    expect(r.success).toBe(false);
  });
});

describe('audio_transcribe tool', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  it('registrado con schema válido', () => {
    const t = getTool('audio_transcribe')!;
    expect(t).toBeTruthy();
    expect(t.parameters.required).toEqual(['path']);
  });

  it('rechaza si OPENAI_API_KEY no está definida', async () => {
    const t = getTool('audio_transcribe')!;
    const r = await t.execute({ path: '/tmp/foo.mp3' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('OPENAI_API_KEY');
  });

  it('rechaza archivo inexistente con key set', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    const t = getTool('audio_transcribe')!;
    const r = await t.execute({ path: 'C:\\nope\\nope\\nope.mp3' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('no encontrado');
  });

  it('rechaza extensión no soportada', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    const t = getTool('audio_transcribe')!;
    // Existe (package.json) pero extensión no permitida.
    const r = await t.execute({ path: 'package.json' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Extensión');
  });

  it('SUPPORTED_EXTENSIONS contiene los 9 formatos esperados', () => {
    expect(SUPPORTED_EXTENSIONS.has('.mp3')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.wav')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.ogg')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.flac')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.m4a')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.webm')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.mp4')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.mpeg')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.mpga')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.txt')).toBe(false);
  });

  it('MAX_SIZE_BYTES = 25MB (límite Whisper)', () => {
    expect(MAX_SIZE_BYTES).toBe(25 * 1024 * 1024);
  });
});
