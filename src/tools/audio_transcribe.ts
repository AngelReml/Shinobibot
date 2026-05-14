/**
 * Audio Transcribe — transcripción de archivos de audio via OpenAI
 * Whisper API. Requiere `OPENAI_API_KEY` en el environment.
 *
 * Soporta: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, flac (hasta 25MB).
 *
 * Política:
 *   - El archivo debe existir y tener extensión soportada.
 *   - Si no hay OPENAI_API_KEY → error claro (no intentamos un fallback
 *     a otro provider porque transcripción es lento+caro y queremos que
 *     el usuario sepa qué está pagando).
 *   - No descargamos modelo local (que pesaría 1-3GB) — eso queda fuera
 *     del scope del .exe portable.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { existsSync, statSync, readFileSync } from 'fs';
import { extname, resolve, basename } from 'path';
import axios from 'axios';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac',
]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB límite Whisper API

const tool: Tool = {
  name: 'audio_transcribe',
  description: 'Transcribe an audio file to text using OpenAI Whisper. Supports mp3/mp4/m4a/wav/webm/ogg/flac (max 25MB). Requires OPENAI_API_KEY.',
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
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return { success: false, output: '', error: 'OPENAI_API_KEY no está definida en el environment — Whisper no es accesible.' };
    }
    const filePath = resolve(args.path);
    if (!existsSync(filePath)) {
      return { success: false, output: '', error: `Archivo no encontrado: ${filePath}` };
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { success: false, output: '', error: `Extensión no soportada: ${ext}. Permitidas: ${[...SUPPORTED_EXTENSIONS].join(', ')}` };
    }
    const stat = statSync(filePath);
    if (stat.size > MAX_SIZE_BYTES) {
      return { success: false, output: '', error: `Archivo demasiado grande (${(stat.size / 1024 / 1024).toFixed(1)}MB > 25MB).` };
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
        return { success: false, output: '', error: 'Whisper devolvió respuesta vacía.' };
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
