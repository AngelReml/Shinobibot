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
import { ABSOLUTE_PROHIBITED_PATHS } from '../utils/permissions.js';

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
    // F2.9 (auditoria 2026-07, antes FIX 1.8) - bloquea rutas de sistema
    // sensibles usando la MISMA lista canonica que el resto del repo
    // (ABSOLUTE_PROHIBITED_PATHS, src/utils/permissions.ts - la que ya usa
    // validatePath/read_file/write_file/run_command). Antes habia
    // aqui una lista AUDIO_PROHIBITED duplicada a mano que divergia de la
    // canonica (omitia '/root' generico y en su lugar listaba solo
    // '/root/.ssh'/'.gnupg'/'.config') - dos fuentes de verdad que podian
    // desincronizarse silenciosamente si una se actualizaba y la otra no.
    // Ahora hay una unica fuente: se compone [...ABSOLUTE_PROHIBITED_PATHS,
    // ...extra] si en el futuro hace falta una ruta extra especifica de
    // audio; hoy no hace falta ninguna. NOTA: ABSOLUTE_PROHIBITED_PATHS
    // incluye '/root' generico (mas amplio que antes) - es la misma
    // restriccion que ya aplica a read_file/write_file/run_command en todo
    // el repo, asi que audio_transcribe deja de ser una excepcion con
    // cobertura mas debil que el resto de tools.
    const lf = filePath.toLowerCase();
    // Un path POSIX-style ('/etc/passwd') pasado a un proceso Windows NO lo
    // reconoce `path.resolve` como absoluto — lo cuelga del cwd, colando el
    // check anterior (que compara contra el path YA resuelto). Se compara
    // TAMBIÉN el string crudo contra las entradas POSIX de la lista, sin
    // pasar por resolve(), para que la convención del SO del proceso no
    // determine si la ruta es prohibida. No se extiende a rutas foráneas que
    // NO están en la lista (p.ej. '/tmp/foo.mp3') — esas deben seguir
    // resolviéndose como siempre y fallar más abajo con "no encontrado" si no
    // existen, para no bloquear de más.
    const rawLower = args.path.toLowerCase().replace(/\\/g, '/');
    const isProhibited = ABSOLUTE_PROHIBITED_PATHS.some(p => {
      const lp = p.toLowerCase();
      if (lf === lp || lf.startsWith(lp + '/') || lf.startsWith(lp + '\\')) return true;
      if (lp.startsWith('/') && (rawLower === lp || rawLower.startsWith(lp + '/'))) return true;
      return false;
    });
    if (isProhibited) {
      return { success: false, output: '', error: 'path traversal denied: ruta de sistema prohibida.' };
    }
    if (!existsSync(filePath)) {
      return { success: false, output: '', error: `Archivo no encontrado: ${filePath}` };
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { success: false, output: '', error: `Extensión no soportada: ${ext}. Permitidas: ${[...SUPPORTED_EXTENSIONS].join(', ')}` };
    }

    const backend = (process.env.SHINOBI_STT_BACKEND || 'auto').toLowerCase();
    const key = process.env.OPENAI_API_KEY;

    if (backend !== 'api') {
      const local = await isWhisperCppAvailable();
      if (local.available) {
        const r = await transcribeWithWhisperCpp(filePath, { language: args.language });
        if (r.ok && r.text) {
          return { success: true, output: r.text };
        }
        if (backend === 'local') {
          return { success: false, output: '', error: `whisper.cpp local fallo: ${r.error ?? 'sin texto'}` };
        }
      } else if (backend === 'local') {
        return { success: false, output: '', error: `whisper.cpp local no disponible: ${local.error}. Configura SHINOBI_WHISPERCPP_BIN + SHINOBI_WHISPERCPP_MODEL.` };
      }
    }

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
        return { success: false, output: '', error: 'Whisper API devolvio respuesta vacia.' };
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
