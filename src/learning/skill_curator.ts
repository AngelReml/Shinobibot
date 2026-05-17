/**
 * Fase 6 del bucle de aprendizaje — el Curator (Motor 2).
 *
 * Mantiene la COLECCIÓN de skills sana a escala. Sin esto, el Motor 1
 * produce decenas de skills estrechas y la librería se vuelve inservible
 * (el matching es por descripción, se diluye). Adaptado de hermes-agent
 * `curator.py` (mapa §2).
 *
 * Disparo: por idle, NO cron — lo llama el ResidentLoop. Gate: opt-in,
 * intervalo (~7d), first-run difiere.
 *
 * Dos fases por pasada:
 *   A. Transiciones automáticas (PURAS, sin LLM): active→stale→archived
 *      según el ancla de staleness de la telemetría. Reactiva si se volvió
 *      a usar. NUNCA borra — 'archived' es un flag reversible y la skill
 *      archivada simplemente deja de inyectarse.
 *   B. Consolidación (LLM auxiliar): el modelo recibe los candidatos y
 *      RECOMIENDA consolidaciones en paraguas. Las recomendaciones van al
 *      REPORT.md para revisión humana — el Curator NO reescribe ni mergea
 *      skills por su cuenta (decisión de diseño: una reescritura autónoma
 *      de la librería del usuario es justo la operación irreversible que
 *      la disciplina del proyecto evita; la ejecución la aprueba un humano).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { invokeLLMViaOpenRouter } from '../cloud/openrouter_fallback.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import {
  listAgentCreatedSkillNames, getUsageRecord, setSkillState, type SkillUsageRecord,
} from './skill_telemetry.js';

export type CuratorInvoker = (payload: LLMChatPayload) => Promise<CloudResponse>;

interface CuratorState {
  last_run_at: string | null;
  paused: boolean;
  run_count: number;
  last_run_summary: string;
}

export interface CuratorCycleResult {
  ran: boolean;
  archived: string[];
  staled: string[];
  reactivated: string[];
  candidates: number;
  consolidationAdvice: string;
  reportDir: string | null;
  note: string;
}

const DAY_MS = 86_400_000;

function statePath(): string { return join(process.cwd(), 'skills', '.curator_state'); }
function nowISO(): string { return new Date().toISOString(); }

function intervalHours(): number { return Number(process.env.SHINOBI_CURATOR_INTERVAL_HOURS) || 168; }
function staleDays(): number { return Number(process.env.SHINOBI_CURATOR_STALE_DAYS) || 30; }
function archiveDays(): number { return Number(process.env.SHINOBI_CURATOR_ARCHIVE_DAYS) || 90; }

/** ¿Está el Curator habilitado? Opt-in, como el resto del bucle. */
export function curatorEnabled(): boolean {
  return process.env.SHINOBI_CURATOR_ENABLED === '1';
}

function loadState(): CuratorState {
  try {
    const p = statePath();
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf-8'));
      return {
        last_run_at: typeof s.last_run_at === 'string' ? s.last_run_at : null,
        paused: !!s.paused,
        run_count: Number(s.run_count) || 0,
        last_run_summary: typeof s.last_run_summary === 'string' ? s.last_run_summary : '',
      };
    }
  } catch { /* fichero corrupto → estado por defecto */ }
  return { last_run_at: null, paused: false, run_count: 0, last_run_summary: '' };
}

function saveState(s: CuratorState): void {
  try {
    const p = statePath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
    renameSync(tmp, p);
  } catch { /* best-effort */ }
}

/**
 * Gate de disparo. First-run: NO corre — siembra `last_run_at` y difiere
 * un intervalo completo (evita una mutación inmediata tras instalar).
 */
export function shouldRunCurator(now: number = Date.now()): boolean {
  if (!curatorEnabled()) return false;
  const s = loadState();
  if (s.paused) return false;
  if (!s.last_run_at) {
    saveState({ ...s, last_run_at: new Date(now).toISOString() });
    return false;
  }
  const elapsed = now - new Date(s.last_run_at).getTime();
  return elapsed >= intervalHours() * 3600_000;
}

/** Prompt de consolidación — "umbrella-building" (mapa §2.3). */
const CURATOR_PROMPT = `You are the skill-library curator. Below is the list of agent-created
skills with their usage telemetry.

A collection of dozens of narrow skills — each capturing one session's
specific case — is a FAILURE of the library, not a feature. An agent
matches skills by description, not exact name; one broad umbrella skill
with labelled subsections beats five narrow siblings.

Method: detect PREFIX CLUSTERS — skills sharing a first word/keyword
(e.g. "gateway-*", "pr-*", "deploy-*"). For each cluster of 2 or more,
recommend ONE of:
  a. merge the siblings into one umbrella skill,
  b. create a new umbrella and absorb the siblings,
  c. demote session-detail siblings to references under an umbrella.

Rules: do NOT recommend deleting anything outright — consolidation only.
Do NOT use a low use_count as a reason against consolidating (counters are
new, mostly 0; use=0 is not evidence of no value).

Respond with a short human-readable list of recommended consolidations,
one per line, in the form:
  <skill-a> + <skill-b> -> <umbrella-name>: <one-sentence reason>
If nothing should be consolidated, respond exactly: "No consolidation needed."

CANDIDATE SKILLS:
`;

function reviewModel(): string {
  return process.env.SHINOBI_REVIEW_MODEL || 'anthropic/claude-haiku-4.5';
}

/** Edad en días desde el ancla (último uso, o creación si nunca se usó). */
function ageDays(rec: SkillUsageRecord, now: number): number {
  const anchorIso = rec.last_used_at ?? rec.created_at;
  const anchor = new Date(anchorIso).getTime();
  if (!Number.isFinite(anchor)) return 0;
  return (now - anchor) / DAY_MS;
}

function writeReport(result: CuratorCycleResult, candidateList: string): string | null {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(process.cwd(), 'logs', 'curator', ts);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify(result, null, 2), 'utf-8');
    const md = [
      `# Curator run — ${ts}`,
      '',
      `## Fase A — transiciones automáticas`,
      `- Archivadas: ${result.archived.join(', ') || '(ninguna)'}`,
      `- Marcadas stale: ${result.staled.join(', ') || '(ninguna)'}`,
      `- Reactivadas: ${result.reactivated.join(', ') || '(ninguna)'}`,
      '',
      `## Fase B — recomendaciones de consolidación (revisión humana)`,
      result.consolidationAdvice || '(sin recomendaciones)',
      '',
      `## Candidatos evaluados`,
      candidateList || '(ninguno)',
    ].join('\n');
    writeFileSync(join(dir, 'REPORT.md'), md, 'utf-8');
    return dir;
  } catch {
    return null;
  }
}

/**
 * Ejecuta una pasada del Curator. Best-effort: nunca lanza.
 * `now` es inyectable para tests del envejecimiento.
 */
export async function runCuratorCycle(
  opts: { invoker?: CuratorInvoker; now?: number } = {},
): Promise<CuratorCycleResult> {
  const now = opts.now ?? Date.now();
  const result: CuratorCycleResult = {
    ran: true, archived: [], staled: [], reactivated: [],
    candidates: 0, consolidationAdvice: '', reportDir: null, note: '',
  };
  try {
    // ── Fase A — transiciones automáticas (sin LLM) ──────────────────────
    for (const name of listAgentCreatedSkillNames()) {
      const rec = getUsageRecord(name);
      if (!rec || rec.pinned) continue; // las pinned se saltan completas
      const age = ageDays(rec, now);
      if (age > archiveDays() && rec.state !== 'archived') {
        setSkillState(name, 'archived');
        result.archived.push(name);
      } else if (age > staleDays() && rec.state === 'active') {
        setSkillState(name, 'stale');
        result.staled.push(name);
      } else if (age <= staleDays() && rec.state === 'stale') {
        setSkillState(name, 'active'); // se volvió a usar
        result.reactivated.push(name);
      }
    }

    // ── Fase B — consolidación (LLM auxiliar, recomendaciones) ───────────
    const surviving = listAgentCreatedSkillNames(); // ya excluye archived
    result.candidates = surviving.length;
    let candidateList = '';
    if (surviving.length >= 2) {
      candidateList = surviving
        .map((n) => {
          const r = getUsageRecord(n);
          return `- ${n} (use=${r?.use_count ?? 0}, state=${r?.state ?? '?'})`;
        })
        .join('\n');
      try {
        const invoke = opts.invoker ?? invokeLLMViaOpenRouter;
        const res = await invoke({
          model: reviewModel(),
          messages: [{ role: 'user', content: CURATOR_PROMPT + candidateList }],
          temperature: 0.2,
          max_tokens: 800,
        });
        if (res.success) {
          let advice = '';
          try {
            const msg = JSON.parse(res.output);
            advice = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content) ? msg.content.map((p: any) => p.text || '').join('') : '';
          } catch { advice = res.output; }
          result.consolidationAdvice = advice.trim();
        }
      } catch (e: any) {
        result.consolidationAdvice = `(consolidación omitida: ${e?.message ?? e})`;
      }
    }

    result.reportDir = writeReport(result, candidateList);

    // ── Estado ───────────────────────────────────────────────────────────
    const s = loadState();
    const summary = `archivadas ${result.archived.length} · stale ${result.staled.length} · ` +
      `reactivadas ${result.reactivated.length} · ${result.candidates} candidatos`;
    saveState({
      last_run_at: new Date(now).toISOString(),
      paused: s.paused,
      run_count: s.run_count + 1,
      last_run_summary: summary,
    });
    result.note = summary;
    return result;
  } catch (e: any) {
    return { ...result, note: `curator falló: ${e?.message ?? e}` };
  }
}
