import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateInputs,
  isWhisperCppAvailable,
  diagnose,
  transcribeWithWhisperCpp,
  SUPPORTED_EXTENSIONS,
} from '../whisper_cpp_provider.js';

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'shinobi-whcpp-'));
  delete process.env.SHINOBI_WHISPERCPP_BIN;
  delete process.env.SHINOBI_WHISPERCPP_MODEL;
});
afterEach(() => {
  try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  delete process.env.SHINOBI_WHISPERCPP_BIN;
  delete process.env.SHINOBI_WHISPERCPP_MODEL;
});

describe('SUPPORTED_EXTENSIONS', () => {
  it('cubre los formatos de audio habituales', () => {
    expect(SUPPORTED_EXTENSIONS.has('.mp3')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.wav')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.m4a')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.flac')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.txt')).toBe(false);
  });
});

describe('validateInputs', () => {
  it('rechaza audioPath vacío', () => {
    const r = validateInputs('', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('vacío');
  });

  it('rechaza archivo inexistente', () => {
    const r = validateInputs(join(work, 'nope.mp3'), { model: join(work, 'm.bin') });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no encontrado/);
  });

  it('rechaza extensión no soportada', () => {
    const p = join(work, 'audio.xyz');
    writeFileSync(p, 'fake');
    const r = validateInputs(p, { model: join(work, 'm.bin') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('extensión');
  });

  it('rechaza archivo vacío', () => {
    const p = join(work, 'audio.mp3');
    writeFileSync(p, '');
    const r = validateInputs(p, { model: join(work, 'm.bin') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('vacío');
  });

  it('rechaza sin modelo configurado', () => {
    const p = join(work, 'audio.mp3');
    writeFileSync(p, 'fake content');
    delete process.env.SHINOBI_WHISPERCPP_MODEL;
    const r = validateInputs(p, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/MODEL|modelo/);
  });

  it('rechaza modelo configurado pero archivo no existe', () => {
    const p = join(work, 'audio.mp3');
    writeFileSync(p, 'fake');
    const r = validateInputs(p, { model: join(work, 'inexistente.bin') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('modelo no encontrado');
  });

  it('ok cuando todo está bien', () => {
    const audio = join(work, 'audio.mp3');
    const model = join(work, 'ggml-tiny.bin');
    writeFileSync(audio, 'fake-audio-bytes');
    writeFileSync(model, 'fake-model');
    process.env.SHINOBI_WHISPERCPP_MODEL = model;
    const r = validateInputs(audio, {});
    expect(r.ok).toBe(true);
  });

  it('opts.model override gana sobre env', () => {
    const audio = join(work, 'audio.wav');
    const model = join(work, 'override.bin');
    writeFileSync(audio, 'x');
    writeFileSync(model, 'y');
    process.env.SHINOBI_WHISPERCPP_MODEL = '/no/existe';
    expect(validateInputs(audio, { model }).ok).toBe(true);
  });
});

describe('isWhisperCppAvailable', () => {
  it('binario inexistente → available=false con error claro', async () => {
    const r = await isWhisperCppAvailable('/binario/que/no/existe/whisper-cli-fake');
    expect(r.available).toBe(false);
    expect(r.binPath).toBe('/binario/que/no/existe/whisper-cli-fake');
    expect(r.error).toBeTruthy();
  });
});

describe('diagnose', () => {
  it('reporta bin + model + binAvailable', async () => {
    process.env.SHINOBI_WHISPERCPP_BIN = '/no-existe/binario';
    const d = await diagnose();
    expect(d.available).toBe(false);
    expect(d.details.join('\n')).toContain('bin:');
    expect(d.details.join('\n')).toContain('model:');
    expect(d.details.join('\n')).toContain('binAvailable:');
  });
});

describe('transcribeWithWhisperCpp', () => {
  it('falla fail-fast si validación NO pasa (sin spawnar binario)', async () => {
    const r = await transcribeWithWhisperCpp(join(work, 'no_audio.mp3'), {});
    expect(r.ok).toBe(false);
    expect(r.text).toBe('');
    expect(r.error).toBeTruthy();
  });

  it('falla con binario inválido tras validación OK', async () => {
    const audio = join(work, 'audio.mp3');
    const model = join(work, 'm.bin');
    writeFileSync(audio, 'data');
    writeFileSync(model, 'm');
    const r = await transcribeWithWhisperCpp(audio, {
      bin: '/no-existe/whisper-cli-fake',
      model,
      timeoutMs: 2000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/spawn|ENOENT/i);
  });
});
