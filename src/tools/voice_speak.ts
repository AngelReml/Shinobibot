/**
 * Voice Speak — síntesis de voz nativa de Windows via System.Speech.
 *
 * Cero dependencias: usa `System.Speech.Synthesis.SpeechSynthesizer` que
 * viene con .NET Framework y está disponible en Windows 10/11 sin
 * instalación adicional. No depende de Azure, Edge TTS HTTP, ni paquetes
 * npm.
 *
 * Voces típicas en Windows 10/11 español:
 *   - Microsoft Helena Desktop (es-ES, female)
 *   - Microsoft Pablo Desktop (es-ES, male)
 *   - Microsoft Sabina Desktop (es-MX, female)
 *
 * Si la voz pedida no está instalada, PowerShell ignora silenciosamente
 * (queda en la voz default). Para listar voces: `(New-Object
 * System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().VoiceInfo.Name`.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, psLit } from './_powershell.js';

const DEFAULT_VOICE = 'Microsoft Helena Desktop';

const tool: Tool = {
  name: 'voice_speak',
  description: 'Speak a text out loud using Windows native speech synthesis (System.Speech). No external dependencies. Useful to alert the user audibly after long tasks. Spanish voice by default.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to speak (max 1000 chars recommended).' },
      voice: { type: 'string', description: 'Optional: installed Windows voice name (e.g. "Microsoft Helena Desktop", "Microsoft Pablo Desktop"). Default: Helena.' },
      rate: { type: 'number', description: 'Optional: speech rate from -10 (very slow) to 10 (very fast). Default 0.' },
    },
    required: ['text'],
  },

  async execute(args: { text: string; voice?: string; rate?: number }): Promise<ToolResult> {
    if (!args.text || args.text.trim().length === 0) {
      return { success: false, output: '', error: 'text vacío' };
    }
    const text = args.text.length > 4000 ? args.text.slice(0, 4000) + '…' : args.text;
    const voice = args.voice && /^[\w\s.\-]{1,80}$/.test(args.voice) ? args.voice : DEFAULT_VOICE;
    const rate = Number.isFinite(args.rate) ? Math.max(-10, Math.min(10, args.rate!)) : 0;
    const script =
      `Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `try { $s.SelectVoice(${psLit(voice)}) } catch { } ; ` +
      `$s.Rate = ${rate}; ` +
      `$s.Speak(${psLit(text)})`;
    const r = await runPowerShell(script, 60_000);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr.trim() || `PowerShell exit ${r.exitCode}` };
    }
    return { success: true, output: `Habló ${text.length} chars con voz ${voice}.` };
  },
};

registerTool(tool);
export default tool;
