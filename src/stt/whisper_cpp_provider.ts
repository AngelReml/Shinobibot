/**
 * Whisper.cpp local STT provider (Sprint 3.7).
 *
 * Independencia de internet y de tokens para transcripción. Envuelve el
 * binario `whisper-cli` (o `main`/`whisper.cpp`) que el operador tiene
 * instalado en su PATH o en `SHINOBI_WHISPERCPP_BIN`.
 *
 * Por qué wrapper de binario y NO node bindings: la build de
 * whisper.cpp depende de hardware (CPU AVX, GPU CUDA/Metal/ROCm) y el
 * operador suele compilar localmente para optimizar. Bindings npm
 * (`nodejs-whisper`, `@xenova/whisper-onnx`) traen modelos pre-built
 * con peor performance y atan a una arquitectura.
 *
 * Detección: `isAvailable()` ejecuta `<bin> --help` con timeout 3s.
 * Modelo: requiere `SHINOBI_WHISPERCPP_MODEL` apuntando a `ggml-*.bin`
 * descargado por el usuario (ej. `models/ggml-small.bin`).
 *
 * Diferenciador vs Whisper API actual (`src/tools/audio_transcribe.ts`):
 * sin red, sin coste, offline-friendly. Costo: el operador descarga el
 * modelo una vez (39 MB tiny → 1.5 GB large).
 */

import { spawn, exec } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';

export interface WhisperCppOptions {
  /** Path al binario whisper.cpp. Default lee SHINOBI_WHISPERCPP_BIN o `whisper-cli`. */
  bin?: string;
  /** Path al modelo .bin (ggml). Default lee SHINOBI_WHISPERCPP_MODEL. */
  model?: string;
  /** ISO-639-1 (es, en, ...). Default 'auto'. */
  language?: string;
  /** Threads para inference. Default 4. */
  threads?: number;
  /** Timeout total del proceso en ms. Default 300_000 (5 min). */
  timeoutMs?: number;
}

export interface WhisperCppResult {
  ok: boolean;
  text: string;
  /** Detected language (cuando se usa --detect-language). */
  language?: string;
  durationMs: number;
  bin: string;
  model: string;
  error?: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mpeg', '.mpga']);
const DEFAULT_BIN = 'whisper-cli';
const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_THREADS = 4;

function resolveBin(explicit?: string): string {
  return explicit ?? process.env.SHINOBI_WHISPERCPP_BIN ?? DEFAULT_BIN;
}

function resolveModel(explicit?: string): string | null {
  const m = explicit ?? process.env.SHINOBI_WHISPERCPP_MODEL ?? null;
  return m ? resolve(m) : null;
}

/**
 * Comprueba si el binario whisper-cli responde a `--help`. NO descarga
 * nada ni valida el modelo — solo el binario.
 */
export function isWhisperCppAvailable(bin?: string): Promise<{ available: boolean; binPath: string; error?: string }> {
  const binPath = resolveBin(bin);
  return new Promise((resolve) => {
    exec(`"${binPath}" --help`, { timeout: 3000, encoding: 'utf-8' }, (err, stdout, stderr) => {
      const helpText = `${stdout}\n${stderr}`;
      // whisper-cli imprime "whisper" o "usage:" en help.
      const available = !err && /whisper|usage:/i.test(helpText);
      resolve({
        available,
        binPath,
        error: available ? undefined : (err?.message || 'help output no contiene "whisper" ni "usage"'),
      });
    });
  });
}

/**
 * Validaciones pre-run que NO requieren ejecutar el binario: archivo
 * existe, extensión soportada, modelo presente. Útil para fail-fast
 * antes de invocar STT pesado.
 */
export function validateInputs(audioPath: string, opts: WhisperCppOptions = {}): { ok: boolean; reason?: string } {
  if (!audioPath || typeof audioPath !== 'string') {
    return { ok: false, reason: 'audioPath vacío' };
  }
  const abs = resolve(audioPath);
  if (!existsSync(abs)) {
    return { ok: false, reason: `archivo no encontrado: ${abs}` };
  }
  const ext = extname(abs).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `extensión no soportada: ${ext}` };
  }
  const stat = statSync(abs);
  if (stat.size === 0) return { ok: false, reason: 'archivo vacío' };
  const model = resolveModel(opts.model);
  if (!model) {
    return { ok: false, reason: 'SHINOBI_WHISPERCPP_MODEL no configurado y no se pasó opts.model' };
  }
  if (!existsSync(model)) {
    return { ok: false, reason: `modelo no encontrado: ${model}` };
  }
  return { ok: true };
}

/**
 * Ejecuta whisper-cli sobre un archivo de audio y devuelve la
 * transcripción en texto plano. Por defecto pide `--output-txt` y
 * captura stdout. Si el binario no soporta esa flag, el caller debe
 * pasar `opts.bin` apuntando a una variante compatible.
 */
export async function transcribeWithWhisperCpp(audioPath: string, opts: WhisperCppOptions = {}): Promise<WhisperCppResult> {
  const t0 = Date.now();
  const binPath = resolveBin(opts.bin);
  const model = resolveModel(opts.model);
  const validation = validateInputs(audioPath, opts);
  if (!validation.ok) {
    return {
      ok: false, text: '', durationMs: Date.now() - t0,
      bin: binPath, model: model ?? '',
      error: validation.reason,
    };
  }
  const args = [
    '-m', model!,
    '-f', resolve(audioPath),
    '--no-prints',
    '--output-txt',
    '-t', String(opts.threads ?? DEFAULT_THREADS),
  ];
  if (opts.language && opts.language !== 'auto') {
    args.push('-l', opts.language);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const proc = spawn(binPath, args);
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* swallow */ }
    }, timeoutMs);
    proc.stdout?.on('data', (b) => { stdout += b.toString('utf-8'); });
    proc.stderr?.on('data', (b) => { stderr += b.toString('utf-8'); });
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        ok: false, text: '', durationMs: Date.now() - t0,
        bin: binPath, model: model!,
        error: `spawn error: ${e.message}`,
      });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false, text: '', durationMs: Date.now() - t0,
          bin: binPath, model: model!,
          error: `timeout after ${timeoutMs}ms`,
        });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false, text: stdout.trim(), durationMs: Date.now() - t0,
          bin: binPath, model: model!,
          error: `exit ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      // El text útil viene en stdout cuando --output-txt está en modo stdout.
      // Algunas builds de whisper.cpp escriben a archivo .txt junto al audio;
      // en ese caso el caller debe leerlo. Aquí asumimos stdout.
      resolve({
        ok: true,
        text: stdout.trim(),
        durationMs: Date.now() - t0,
        bin: binPath,
        model: model!,
      });
    });
  });
}

/** Diagnóstico para el operador: explica qué falta. */
export async function diagnose(): Promise<{ available: boolean; details: string[] }> {
  const details: string[] = [];
  const bin = resolveBin();
  details.push(`bin: ${bin}`);
  const model = resolveModel();
  details.push(`model: ${model ?? '(no configurado)'}`);
  const avail = await isWhisperCppAvailable(bin);
  details.push(`binAvailable: ${avail.available}${avail.error ? ` (${avail.error})` : ''}`);
  if (model) details.push(`modelExists: ${existsSync(model)}`);
  const allOk = avail.available && model != null && existsSync(model);
  return { available: allOk, details };
}

export { SUPPORTED_EXTENSIONS };
