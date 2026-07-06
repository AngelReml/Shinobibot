// src/tools/kagemusha_run.ts
//
// F5 (2026-07-06, remate P5-Nivel 1) — la "one-line follow-up" que el propio
// trigger.ts (F4.1) dejó anotada: run_kagemusha como Tool nativa. Lanza UNA
// misión nocturna de Kagemusha bajo demanda (ingesta → análisis → hilos →
// contraste → Informe del Amanecer) y devuelve el resumen + ruta del informe.
//
// Seguridad y honestidad, por diseño:
//   - Doble gate: KAGEMUSHA_ENABLED (default off) — sin él la tool responde
//     un error claro, jamás corre. Y requiresConfirmation() → el gate selectivo
//     D-017 pide aprobación según su modo (una misión hace egress + puede
//     gastar LLM; no es una acción trivial).
//   - Egress: las costuras vivas (live/deps.ts) SOLO usan tools ya autorizadas
//     (web_search/clean_extract, con gate de consentimiento F1.3) y subproceso
//     yt-dlp (patrón SEC-F4.2). `live:false` corre la misión 100% offline
//     (los hilos registran huecos honestos en vez de adquirir).
//   - El scheduler nocturno NO existe a propósito (decisión de producto
//     pendiente del operador: ventana, fuentes, techo de gasto). Esta tool es
//     el disparo manual/bajo demanda; programarla sería una línea con
//     task_scheduler_create el día que esa decisión se tome.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runKagemusha, KagemushaDisabledError, type RunKagemushaOptions } from '../kagemusha/trigger.js';
import { kagemushaEnabled } from '../kagemusha/config.js';
import { buildLiveDeps } from '../kagemusha/live/deps.js';
import * as path from 'node:path';

function defaultDir(sub: string): string {
  return path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi', sub);
}

const runKagemushaTool: Tool = {
  name: 'run_kagemusha',
  description:
    'Run ONE Kagemusha night-research mission now: download channel transcripts (yt-dlp), multi-angle analysis, ' +
    'pull threads with the credibility rubric (§8.5 — deterministic, a tier-0 comment never becomes a fact), ' +
    'contrast findings against our own codebase, and write the Dawn Report to reports/<mission_id>.md. ' +
    'Gated by KAGEMUSHA_ENABLED=1 (refuses otherwise). Set live=false for a fully-offline run (honest gaps instead of network). ' +
    'Budgets (threads/depth/time) are enforced; running out produces a partial, honest report — never silence.',
  parameters: {
    type: 'object',
    properties: {
      channels: {
        type: 'array', items: { type: 'string' },
        description: 'YouTube channels to ingest (handle like "@canal", channel id UC…, or full youtube.com URL). Validated against a strict allowlist before any command is built.',
      },
      max_transcripts_per_channel: { type: 'number', description: 'Cap of transcripts per channel (yt-dlp --playlist-end). Default 10.' },
      max_threads: { type: 'number', description: 'Budget: max threads to pull (frontier). Default 10.' },
      max_depth: { type: 'number', description: 'Budget: max thread depth (expansion of citations). Default 2.' },
      max_wall_clock_minutes: { type: 'number', description: 'Budget: wall-clock cap for the whole mission. Default 30.' },
      live: { type: 'boolean', description: 'Inject the live seams (web fetch via authorized tools + yt-dlp resolvers). Default true. false = fully offline mission.' },
      out_dir: { type: 'string', description: 'Folder for downloaded subtitle files. Default %APPDATA%/Shinobi/kagemusha_subs.' },
      reports_dir: { type: 'string', description: 'Folder for the Dawn Report .md. Default <kagemusha.db dir>/reports.' },
      repo_root: { type: 'string', description: 'Repo root for the CONTRAST phase self-index. Default: process.cwd(). Empty string skips contrast.' },
    },
    required: ['channels'],
  },

  // Una misión hace egress y puede gastar LLM: que el gate selectivo (D-017)
  // decida según su modo. Nunca silenciosamente.
  requiresConfirmation: () => true,
  categories: ['research', 'kagemusha'],

  async execute(args: {
    channels: string[]; max_transcripts_per_channel?: number; max_threads?: number; max_depth?: number;
    max_wall_clock_minutes?: number; live?: boolean; out_dir?: string; reports_dir?: string; repo_root?: string;
  }): Promise<ToolResult> {
    if (!kagemushaEnabled()) {
      return {
        success: false, output: '',
        error: 'Kagemusha está desactivado. Exporta KAGEMUSHA_ENABLED=1 para permitir misiones nocturnas (gate deliberado, default off).',
      };
    }
    if (!Array.isArray(args.channels) || args.channels.length === 0) {
      return { success: false, output: '', error: 'channels: se necesita al menos un canal (handle @…, id UC…, o URL de youtube.com).' };
    }

    const live = args.live !== false;
    const liveDeps = live ? buildLiveDeps() : undefined;

    const opts: RunKagemushaOptions = {
      channels: args.channels,
      maxTranscriptsPerChannel: args.max_transcripts_per_channel ?? 10,
      outDir: args.out_dir || defaultDir('kagemusha_subs'),
      reportsDir: args.reports_dir || undefined,
      repoRoot: args.repo_root === '' ? undefined : (args.repo_root || process.cwd()),
      budget: {
        maxThreads: args.max_threads ?? 10,
        maxDepth: args.max_depth ?? 2,
        maxWallClockMs: Math.round((args.max_wall_clock_minutes ?? 30) * 60_000),
      },
      fetcher: liveDeps?.fetcher,
      resolveDeps: liveDeps?.resolveDeps,
      asyncContrastJudge: liveDeps?.asyncContrastJudge,
    };

    try {
      const r = await runKagemusha(opts);
      const rep = r.report;
      const summary = {
        mission_id: r.state.mission_id,
        phase: r.state.phase,
        live,
        report_path: r.reportPath ?? null,
        looked_at: rep?.looked_at ?? null,
        highlights: rep?.highlights.length ?? 0,
        discarded: rep?.discarded.length ?? 0,
        build_suggestions: rep?.build_suggestions.length ?? 0,
        gaps: rep?.gaps ?? r.state.gaps,
        integrity: rep?.integrity ?? null,
        per_phase_tokens: r.perPhaseTokens,
      };
      return { success: true, output: JSON.stringify(summary, null, 2) };
    } catch (e: any) {
      if (e instanceof KagemushaDisabledError) return { success: false, output: '', error: e.message };
      return { success: false, output: '', error: `run_kagemusha falló: ${e?.message ?? String(e)}` };
    }
  },
};

registerTool(runKagemushaTool);
