/**
 * Audio Transcribe — transcripción de archivos de audio.
 *
 * Estrategia (FASE V3): **whisper.cpp local primero, Whisper API como
 * fallback**.
 *   1. Si whisper.cpp está disponible (binario + modelo configurados vía
 *      SHINOBI_WHISPERCPP_BIN / SHINOBI_WHISPERCPP_MODEL), transcribe
 *      localmente — cero coste, cero internet.
 *   2. Si no, cae a OpenAI Whisper API (requiere OPENAI_API_KEY).
 *   3. Si ninguno está disponible → error claro listando ambas opciones.
 *
 * Forzar un backend concreto: `SHINOBI_STT_BACKEND=local` | `api`.
 *
 * Soporta: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, flac (API hasta 25MB).
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { existsSync, statSync, readFileSync } from 'fs';
import { extname, resolve, basename } from 'path';
import axios from 'axios';
import { isWhisperCppAvailable, transcribeWithWhisperCpp } from '../stt/whisper_cpp_provider.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac',
]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB límite Whisper API

const tool: Tool = {
  name: 'audio_transcribe',
  description: 'Transcribe an audio file to text. Uses local whisper.cpp if configured (SHINOBI_WHISPERCPP_BIN/MODEL), else falls back to OpenAI Whisper API. Supports mp3/mp4/m4a/wav/webm/ogg/flac.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the audio file.' },
      language: { type: 'string', description: 'Optional: ISO-639-1 code (e.g. "es", "en") to improve accuracy. Auto-detected if omitted.' },
      prompt: { type: 'string', description: 'Optional: context prompt to bias the transcription (e.g. names, jargon).' },
    },
    required: ['path'],
  },

  async execute(args: { path: string; language?: string; prompt?: string }): Promise<ToolResult> {
    const filePath = resolve(args.path);
    if (!existsSync(filePath)) {
      return { success: false, output: '', error: `Archivo no encontrado: ${filePath}` };
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { success: false, output: '', error: `Extensión no soportada: ${ext}. Permitidas: ${[...SUPPORTED_EXTENSIONS].join(', ')}` };
    }

    const backend = (process.env.SHINOBI_STT_BACKEND || 'auto').toLowerCase();
    const key = process.env.OPENAI_API_KEY;

    // ── Backend 1: whisper.cpp local ──
    // Se intenta primero salvo que el operador fuerce 'api'.
    if (backend !== 'api') {
      const local = await isWhisperCppAvailable();
      if (local.available) {
        const r = await transcribeWithWhisperCpp(filePath, { language: args.language });
        if (r.ok && r.text) {
          return { success: true, output: r.text };
        }
        // whisper.cpp falló: si el operador forzó 'local', error; si no, cae a API.
        if (backend === 'local') {
          return { success: false, output: '', error: `whisper.cpp local falló: ${r.error ?? 'sin texto'}` };
        }
      } else if (backend === 'local') {
        return { success: false, output: '', error: `whisper.cpp local no disponible: ${local.error}. Configura SHINOBI_WHISPERCPP_BIN + SHINOBI_WHISPERCPP_MODEL.` };
      }
    }

    // ── Backend 2: OpenAI Whisper API (fallback) ──
    if (!key) {
      return {
        success: false, output: '',
        error: 'STT no disponible: whisper.cpp local no configurado (SHINOBI_WHISPERCPP_BIN/MODEL) y OPENAI_API_KEY ausente.',
      };
    }
    const stat = statSync(filePath);
    if (stat.size > MAX_SIZE_BYTES) {
      return { success: false, output: '', error: `Archivo demasiado grande para Whisper API (${(stat.size / 1024 / 1024).toFixed(1)}MB > 25MB). Usa whisper.cpp local para archivos grandes.` };
    }

    try {
      // FormData global (Node 18+) acepta Blob para archivos.
      const buffer = readFileSync(filePath);
      const blob = new Blob([new Uint8Array(buffer)]);
      const form = new FormData();
      form.append('file', blob, basename(filePath));
      form.append('model', 'whisper-1');
      if (args.language) form.append('language', args.language);
      if (args.prompt) form.append('prompt', args.prompt);
      const resp = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 120_000,
          maxBodyLength: MAX_SIZE_BYTES + 1024,
        },
      );
      const text = (resp.data?.text ?? '').toString();
      if (!text) {
        return { success: false, output: '', error: 'Whisper API devolvió respuesta vacía.' };
      }
      return { success: true, output: text };
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
      return { success: false, output: '', error: `Whisper error: ${msg}` };
    }
  },
};

registerTool(tool);
export default tool;
export { SUPPORTED_EXTENSIONS, MAX_SIZE_BYTES };
