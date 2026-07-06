/**
 * kagemusha/live/deps.ts — F5 (2026-07-06, remate P5-Nivel 1): las costuras VIVAS
 * del dossier §8 (RESOLVE/ACQUIRE) que hasta hoy solo existían como fakes de test.
 * Sin esto, THREAD registra "sin fetcher inyectado" para todo y el Informe del
 * Amanecer es honesto pero vacío.
 *
 * Tres reglas de diseño, verificadas contra el repo real:
 *
 * 1. EGRESS. `src/kagemusha/` NO está en EGRESS_ALLOWLIST (src/egress/
 *    egress_policy.ts) — este módulo no abre sockets ni importa clientes HTTP.
 *    Toda la red pasa por (a) tools ya autorizadas y con gate de consentimiento
 *    F1.3 (`web_search`, `clean_extract`) vía tool_registry, o (b) subproceso
 *    yt-dlp con execFile SIN shell — el mismo patrón endurecido de
 *    ingest/transcripts.ts (SEC-F4.2), con validación estricta del videoId antes
 *    de construir argv.
 * 2. FAIL-CLOSED. Cualquier fallo (tool no registrada, yt-dlp ausente, JSON
 *    malformado, LLM incoherente) devuelve null/ok:false → el hilo registra un
 *    hueco honesto. Nunca contenido fabricado (§2.8 del dossier).
 * 3. INYECTABLE. Cada builder acepta sus efectos (caller de tools, exec, llm)
 *    como parámetro con default real — testeable offline, como el resto del
 *    módulo (⚑ LIVE-seam).
 */

import { execFile } from 'node:child_process';
import { getTool } from '../../tools/tool_registry.js';
import { extractReferences, tierForUrl, type ResolveDeps } from '../thread/resolve.js';
import type { Fetcher } from '../thread/acquire.js';
// adapters.js se importa PEREZOSAMENTE (dynamic import) dentro del juez LLM:
// cargar las costuras vivas no debe arrastrar la cadena agents/providers entera.
import type { KageMessage } from '../adapters.js';
import { judgeModel } from '../config.js';
import type { AsyncContrastJudge } from '../contrast/contrast.js';
import type { ContrastLabel } from '../types.js';

// ── Efectos inyectables ───────────────────────────────────────────────────────

/** Llama una tool registrada. Default: el tool_registry real (egress ya gobernado allí). */
export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; output: string; error?: string }>;

const registryToolCall: ToolCall = async (name, args) => {
  const t = getTool(name);
  if (!t) return { success: false, output: '', error: `tool "${name}" no registrada (¿se cargó src/tools/index.ts?)` };
  try { return await t.execute(args); }
  catch (e: any) { return { success: false, output: '', error: e?.message ?? String(e) }; }
};

/** Ejecuta yt-dlp con argv discreto, sin shell (patrón SEC-F4.2). */
export type ExecYtDlp = (argv: string[], timeoutMs: number) => Promise<{ ok: boolean; stdout: string }>;

const realExecYtDlp: ExecYtDlp = (argv, timeoutMs) => new Promise((resolve) => {
  execFile('yt-dlp', argv, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? '') }));
});

// ── Parsers puros (testeables sin red) ────────────────────────────────────────

/** Allowlist estricta de un video id de YouTube — se valida ANTES de armar argv. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export function isValidVideoId(v: string): boolean { return VIDEO_ID_RE.test(v); }

/** Salida de `--print "%(description)s"` → texto o null ("NA"/vacío = no hay). */
export function parsePrintedField(stdout: string): string | null {
  const s = stdout.trim();
  return s && s !== 'NA' && s !== 'null' ? s : null;
}

/** Salida de `--print "%(comments)j"` → texto del comentario con más likes, o null. */
export function parseTopComment(stdout: string): string | null {
  try {
    const arr = JSON.parse(stdout.trim());
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => (b?.like_count ?? 0) - (a?.like_count ?? 0));
    const t = sorted[0]?.text;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  } catch { return null; }
}

/** Hosts que son ruido de buscador/plataforma, nunca una fuente a adquirir.
 *  Por HOSTNAME parseado, no por regex sobre la URL cruda (una regex con
 *  `(^|\.)` dejaba pasar `https://youtu.be/…` — el host va tras `//`). */
const NOISE_HOSTS = ['bing.com', 'duckduckgo.com', 'microsoft.com', 'youtube.com', 'youtu.be'];
export function isSearchNoiseUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    if (NOISE_HOSTS.some((d) => h === d || h.endsWith('.' + d))) return true;
    return /(^|\.)google\.[a-z.]+$/.test(h);
  } catch { return true; }                                 // URL imparseable → ruido (fail-closed)
}

/** De la salida cruda de web_search, la mejor URL candidata (tier alto primero), o null. */
export function pickSearchResult(output: string): { url: string; tier: 0 | 1 | 2 | 3 } | null {
  const { urls } = extractReferences(output);
  const candidates = urls.filter((u) => !isSearchNoiseUrl(u));
  const best = candidates.find((u) => tierForUrl(u) >= 2) ?? candidates.find((u) => tierForUrl(u) >= 1);
  return best ? { url: best, tier: tierForUrl(best) } : null;
}

// ── RESOLVE vivo (§8.2, pasos 2–4 de la cascada) ─────────────────────────────

export interface LiveResolveOptions { exec?: ExecYtDlp; call?: ToolCall; }

/**
 * Resolvers vivos para la cascada RESOLVE: descripción y comentario fijado vía
 * yt-dlp (subproceso, sin API key, sin CDP), búsqueda web vía la tool `web_search`
 * ya autorizada. Con caché por vídeo — un vídeo no se consulta dos veces por misión.
 */
export function buildLiveResolveDeps(opts: LiveResolveOptions = {}): ResolveDeps {
  const exec = opts.exec ?? realExecYtDlp;
  const call = opts.call ?? registryToolCall;
  const descCache = new Map<string, string | null>();
  const commentCache = new Map<string, string | null>();

  return {
    async getDescription(videoId: string): Promise<string | null> {
      if (!isValidVideoId(videoId)) return null;               // fail-closed, sin subproceso
      if (descCache.has(videoId)) return descCache.get(videoId)!;
      const r = await exec(['--skip-download', '--no-warnings', '--print', '%(description)s',
        `https://www.youtube.com/watch?v=${videoId}`], 30_000);
      const d = r.ok ? parsePrintedField(r.stdout) : null;
      descCache.set(videoId, d);
      return d;
    },

    async getTopComment(videoId: string): Promise<string | null> {
      if (!isValidVideoId(videoId)) return null;
      if (commentCache.has(videoId)) return commentCache.get(videoId)!;
      const r = await exec(['--skip-download', '--no-warnings', '--write-comments',
        '--extractor-args', 'youtube:comment_sort=top;max_comments=10,10,0',
        '--print', '%(comments)j', `https://www.youtube.com/watch?v=${videoId}`], 60_000);
      const c = r.ok ? parseTopComment(r.stdout) : null;
      commentCache.set(videoId, c);
      return c;
    },

    async webSearch(query: string): Promise<{ url: string; tier: 0 | 1 | 2 | 3 } | null> {
      const r = await call('web_search', { query });
      if (!r.success || !r.output.trim()) return null;
      return pickSearchResult(r.output);
    },
  };
}

// ── ACQUIRE vivo (§8.3) ───────────────────────────────────────────────────────

/**
 * Fetcher real sobre las tools autorizadas: `clean_extract` (markdown limpio del
 * contenido principal) con fallback a `web_search` (navegación a URL exacta).
 * Ambas pasan por el gate de consentimiento F1.3 — Kagemusha no lo evade.
 */
export function buildLiveFetcher(opts: { call?: ToolCall } = {}): Fetcher {
  const call = opts.call ?? registryToolCall;
  return async (url: string) => {
    const ce = await call('clean_extract', { url });
    if (ce.success && ce.output.trim()) {
      try {
        const j = JSON.parse(ce.output);
        const text = [j.title, j.content_md ?? j.content].filter(Boolean).join('\n\n');
        if (text.trim()) return { ok: true, text, finalUrl: typeof j.url === 'string' ? j.url : url };
      } catch { return { ok: true, text: ce.output }; }   // salida no-JSON pero con contenido
    }
    const ws = await call('web_search', { query: url });
    if (ws.success && ws.output.trim()) return { ok: true, text: ws.output };
    return { ok: false, text: '', error: ce.error ?? ws.error ?? 'sin contenido adquirible' };
  };
}

// ── Juez de contraste con modelo fuerte (§9.2 / §12.3) ───────────────────────

export type LLMCall = (messages: KageMessage[], model?: string) => Promise<{ ok: boolean; text: string; error?: string }>;

const VALID_VERDICTS: ContrastLabel[] = ['SIRVE', 'YA_LO_TENEMOS', 'MEJOR_QUE_NOSOTROS', 'IRRELEVANTE'];

/**
 * Juez LLM para el matiz SIRVE/YA_LO_TENEMOS/MEJOR_QUE_NOSOTROS — el modelo
 * fuerte (judgeModel) SOLO decide entre las cuatro etiquetas sobre un candidato
 * que el ranking determinista ya eligió; si devuelve cualquier cosa no parseable
 * o fuera del enum, se descarta (null) y manda el fallback determinista.
 * El LLM matiza; nunca fabrica el veredicto desde fuera de la rúbrica.
 */
export function makeLLMContrastJudge(opts: { llm?: LLMCall; model?: string } = {}): AsyncContrastJudge {
  // Lazy: la cadena de providers solo se carga si el juez LLM llega a usarse.
  const llm: LLMCall = opts.llm ?? (async (messages, model) => (await import('../adapters.js')).kageLLM(messages, model));
  return async (findingText, unit, overlap) => {
    const model = opts.model ?? (judgeModel() || undefined);
    const res = await llm([
      {
        role: 'system',
        content: 'Eres el juez de contraste de Kagemusha. Comparas un hallazgo de investigación con un módulo del propio código. Responde SOLO un JSON: {"verdict":"SIRVE"|"YA_LO_TENEMOS"|"MEJOR_QUE_NOSOTROS"|"IRRELEVANTE","rationale":"una frase con el porqué"}. Sin markdown, sin nada más.',
      },
      {
        role: 'user',
        content: `Hallazgo: ${findingText}\n\nMódulo del repo: ${unit.path} :: ${unit.symbol}\nCapacidad: ${unit.capability_summary}\nSolape léxico medido: ${overlap.toFixed(2)}`,
      },
    ], model).catch(() => ({ ok: false as const, text: '' }));
    if (!res.ok || !res.text) return null;
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const j = JSON.parse(m[0]);
      if (!VALID_VERDICTS.includes(j.verdict)) return null;
      const rationale = typeof j.rationale === 'string' && j.rationale.trim() ? j.rationale.trim().slice(0, 300) : null;
      if (!rationale) return null;
      return { verdict: j.verdict as ContrastLabel, rationale: `[juez llm] ${rationale}` };
    } catch { return null; }
  };
}

// ── Paquete completo para el tool wrapper ─────────────────────────────────────

export interface LiveDeps {
  resolveDeps: ResolveDeps;
  fetcher: Fetcher;
  asyncContrastJudge?: AsyncContrastJudge;
}

/**
 * Las dependencias vivas por defecto para una misión real. El juez LLM es
 * opt-in explícito (KAGEMUSHA_LLM_JUDGE=1) porque añade gasto por claim;
 * el resto del juicio es determinista por diseño (§8.5: la rúbrica decide).
 */
export function buildLiveDeps(): LiveDeps {
  return {
    resolveDeps: buildLiveResolveDeps(),
    fetcher: buildLiveFetcher(),
    asyncContrastJudge: process.env.KAGEMUSHA_LLM_JUDGE === '1' ? makeLLMContrastJudge() : undefined,
  };
}
