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
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
  const STT_ENV = ['OPENAI_API_KEY', 'SHINOBI_STT_BACKEND', 'SHINOBI_WHISPERCPP_BIN', 'SHINOBI_WHISPERCPP_MODEL'];
  beforeEach(() => { for (const k of STT_ENV) delete process.env[k]; });
  afterEach(() => { for (const k of STT_ENV) delete process.env[k]; });

  it('registrado con schema válido', () => {
    const t = getTool('audio_transcribe')!;
    expect(t).toBeTruthy();
    expect(t.parameters.required).toEqual(['path']);
  });

  it('rechaza archivo inexistente (file check primero)', async () => {
    const t = getTool('audio_transcribe')!;
    const r = await t.execute({ path: 'C:\\nope\\nope\\nope.mp3' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('no encontrado');
  });

  it('rechaza extensión no soportada', async () => {
    const t = getTool('audio_transcribe')!;
    // Existe (package.json) pero extensión no permitida.
    const r = await t.execute({ path: 'package.json' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Extensión');
  });

  it('sin whisper.cpp ni OPENAI_API_KEY → error que menciona ambos backends', async () => {
    // Archivo de audio válido pero ningún backend disponible.
    const dir = mkdtempSync(join(tmpdir(), 'shinobi-stt-'));
    const audio = join(dir, 'sample.wav');
    writeFileSync(audio, 'fake-wav-bytes');
    try {
      const t = getTool('audio_transcribe')!;
      const r = await t.execute({ path: audio });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/whisper\.cpp/i);
      expect(r.error).toMatch(/OPENAI_API_KEY/);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SHINOBI_STT_BACKEND=local sin whisper.cpp → error claro de config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shinobi-stt-'));
    const audio = join(dir, 'sample.wav');
    writeFileSync(audio, 'fake-wav-bytes');
    process.env.SHINOBI_STT_BACKEND = 'local';
    process.env.SHINOBI_WHISPERCPP_BIN = '/no/existe/whisper-cli-fake';
    try {
      const t = getTool('audio_transcribe')!;
      const r = await t.execute({ path: audio });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/SHINOBI_WHISPERCPP/);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
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
