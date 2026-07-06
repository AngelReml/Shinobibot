// runtime/night_cycle.ts — el ciclo nocturno.
//
// Encadena, bajo UN presupuesto fail-closed ($10/noche, night_budget.ts):
//   1. Kagemusha investiga — ELIGE ÉL MISMO los temas (sin canales a mano: sigue
//      su propio grafo persistido; honesto si no hay nada nuevo, igual que ya
//      hacía runKagemusha con 0 canales).
//   2. Kangeiko fabrica con el sintetizador REAL (LLM + jaula isolated-vm) contra
//      un banco de práctica fijo, bajo el tope restante. Enciende
//      SHINOBI_SYNTH_LLM=1 solo durante la fabricación (lo restaura al salir).
//   3. decideAdoption (adoption_policy) decide: certificada+pura ⇒ se guarda sola
//      en el repertorio de Kangeiko. Nunca auto-adopta lo que pida efectos o no
//      esté certificado (fail-closed, igual que la puerta).
//   4. Deja un "informe del amanecer" en fichero, SIEMPRE (ABORT nunca es silencio).
//
// Additive y gated por SHINOBI_NIGHT_CYCLE_ENABLED (default off). El disparo por
// cron 2am reutiliza mission_scheduler.isDue — no reinventa el parsing de cron.
// El ResidentLoop es quien decide CUÁNDO llamar (nightCycleDue) y quien registra
// que corrió (markNightCycleRan); runNightCycle() en sí es la UNIDAD DE TRABAJO,
// sin acoplarse al estado de scheduling (más fácil de testear con inyección).

import * as path from 'node:path';
import * as fs from 'node:fs';
import { isDue, parseTrigger, type MissionTrigger } from './mission_scheduler.js';
import { nightBudgetExceeded, nightlyBudgetUsd } from './night_budget.js';
import { kagemushaEnabled } from '../kagemusha/config.js';
import { runKagemusha, type RunKagemushaOptions, type RunKagemushaResult } from '../kagemusha/trigger.js';
import { createDefaultSynthesizer } from '../kangeiko/synth/default_synth.js';
import { fabricateAsync, type AsyncSynthesizer } from '../kangeiko/fabricate_async.js';
import type { OracleTask } from '../kangeiko/held_out_oracle.js';
import { sharedKangeikoStore, KangeikoStore } from '../kangeiko/store.js';
import { decideAdoption, type AdoptionCandidate, type AdoptionVerdict } from '../skills/adoption_policy.js';

function appDataShinobiDir(): string {
  return path.join(process.env.APPDATA || process.env.HOME || '.', 'Shinobi');
}

// ─── Gate ────────────────────────────────────────────────────────────────────

export function nightCycleEnabled(): boolean {
  return process.env.SHINOBI_NIGHT_CYCLE_ENABLED === '1';
}

export class NightCycleDisabledError extends Error {
  constructor() {
    super('El ciclo nocturno está desactivado (SHINOBI_NIGHT_CYCLE_ENABLED no es 1). runNightCycle() se niega a correr.');
    this.name = 'NightCycleDisabledError';
  }
}

/** 2am cada noche — reutiliza el parser/matcher de mission_scheduler.ts, no lo reinventa. */
export const NIGHT_CYCLE_TRIGGER: MissionTrigger = parseTrigger({ kind: 'cron', expr: '0 2 * * *' });

/** Puro: ¿toca correr ya, dado el último run conocido? */
export function shouldRunNightCycle(lastRunAt: string | null, now: Date = new Date()): boolean {
  return isDue(NIGHT_CYCLE_TRIGGER, lastRunAt, now);
}

interface NightCycleSchedState { last_run_at: string | null; run_count: number; }

function statePath(): string { return path.join(appDataShinobiDir(), 'night_cycle_state.json'); }

function loadSchedState(): NightCycleSchedState {
  try {
    const p = statePath();
    if (fs.existsSync(p)) {
      const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { last_run_at: typeof s.last_run_at === 'string' ? s.last_run_at : null, run_count: Number(s.run_count) || 0 };
    }
  } catch { /* estado corrupto → arranca de cero */ }
  return { last_run_at: null, run_count: 0 };
}

function saveSchedState(s: NightCycleSchedState): void {
  try {
    const p = statePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
  } catch { /* best-effort, igual que el resto de gates del resident loop */ }
}

/** Gate impuro para el ResidentLoop: habilitado + debido según el cron persistido. */
export function nightCycleDue(now: number = Date.now()): boolean {
  if (!nightCycleEnabled()) return false;
  return shouldRunNightCycle(loadSchedState().last_run_at, new Date(now));
}

/** El ResidentLoop llama esto tras un runNightCycle() exitoso para no re-disparar. */
export function markNightCycleRan(now: number = Date.now()): void {
  const s = loadSchedState();
  saveSchedState({ last_run_at: new Date(now).toISOString(), run_count: s.run_count + 1 });
}

// ─── Kagemusha: elige él mismo los temas ────────────────────────────────────

/**
 * "Kagemusha elige él mismo los temas": sin canales configurados a mano
 * (SHINOBI_KAGEMUSHA_CHANNELS), no bloquea ni inventa — continúa investigando
 * sobre su propio grafo persistido (entidades/citas ya descubiertas en noches
 * anteriores), exactamente como runKagemusha ya se comporta con 0 canales
 * nuevos: honesto (hilos de lo ya conocido, o informe vacío si no hay nada).
 */
export function chooseNightlyChannels(): string[] {
  const raw = process.env.SHINOBI_KAGEMUSHA_CHANNELS;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── Kangeiko: banco de práctica fijo (bajo el tope) ────────────────────────

/** Transformación canónica de práctica (mismo idioma que llm_synth.test.ts / fabricate_async.test.ts). */
const NIGHTLY_ORACLE_TASKS: OracleTask<number, number>[] = [
  { input: 1, expected: 2 }, { input: 2, expected: 4 }, { input: 3, expected: 6 },
  { input: 4, expected: 8 }, { input: 5, expected: 10 }, { input: 6, expected: 12 },
];
const NIGHTLY_CAPABILITY_ID = 'double_number';

// Estimaciones de coste — mismo espíritu que estCostPerTaskUsd en swarm_orchestrator:
// un placeholder documentado, no telemetría exacta (pendiente cablear coste real).
const USD_PER_1K_KAGEMUSHA_TOKENS = 0.01;
const FABRICATE_ATTEMPT_COST_USD = 0.05;

// ─── Resultado ───────────────────────────────────────────────────────────────

export interface NightCycleResult {
  ranAt: string;
  budgetUsd: number;
  spentUsd: number;
  budgetStoppedEarly: boolean;
  kagemusha: { ran: boolean; reason?: string; reportPath?: string; gaps: number; threadsInvestigated: number };
  kangeiko: { attempted: boolean; certified: boolean; adopted: boolean; verdict?: AdoptionVerdict; reason?: string };
  reportPath: string;
}

export interface NightCycleOptions {
  now?: () => number;
  budgetUsd?: number;
  /** Runner de kagemusha. Default: runKagemusha real. Inyectable para test. */
  kagemushaRunner?: (opts: RunKagemushaOptions) => Promise<RunKagemushaResult>;
  kagemushaOptions?: Partial<RunKagemushaOptions>;
  /** Sintetizador. Default: createDefaultSynthesizer<number,number>() real (respeta SHINOBI_SYNTH_LLM). */
  synth?: AsyncSynthesizer<number, number>;
  store?: KangeikoStore;
  reportsDir?: string;
}

function writeNightlyReport(reportsDir: string, r: Omit<NightCycleResult, 'reportPath'>): string {
  const lines: string[] = [
    '# Informe del Amanecer — ciclo nocturno',
    '',
    `*${r.ranAt}*`,
    '',
    '## Kagemusha (investigación) — elige sus propios temas',
  ];
  if (r.kagemusha.ran) {
    lines.push(`Hilos investigados: ${r.kagemusha.threadsInvestigated} · huecos: ${r.kagemusha.gaps}.`);
    if (r.kagemusha.reportPath) lines.push(`Informe detallado: ${r.kagemusha.reportPath}`);
  } else {
    lines.push(`_Omitido: ${r.kagemusha.reason ?? 'sin razón registrada'}_`);
  }
  lines.push('', '## Kangeiko (fabricación bajo tope)');
  if (r.kangeiko.attempted) {
    lines.push(`Certificado contra casos ocultos: ${r.kangeiko.certified ? 'sí' : 'no'}.`);
    if (r.kangeiko.certified) {
      lines.push(`Veredicto de adopción: **${r.kangeiko.verdict}** — ${r.kangeiko.adopted ? 'se guardó sola' : 'no se guardó automáticamente'}.`);
    }
    if (r.kangeiko.reason) lines.push(`_Nota: ${r.kangeiko.reason}_`);
  } else {
    lines.push(`_Omitido: ${r.kangeiko.reason ?? 'sin razón registrada'}_`);
  }
  lines.push(
    '',
    '## Presupuesto',
    `- Techo: $${r.budgetUsd.toFixed(2)}/noche`,
    `- Gastado (estimado): $${Number.isFinite(r.spentUsd) ? r.spentUsd.toFixed(2) : 'no medible'}`,
    `- Parado por presupuesto: ${r.budgetStoppedEarly ? 'sí' : 'no'}`,
    '',
    '_No se afirma nada no verificado: lo certificado lo certificó el oráculo de casos ocultos, no un LLM._',
    '',
  );
  fs.mkdirSync(reportsDir, { recursive: true });
  const fname = `night_${r.ranAt.replace(/[:.]/g, '-')}.md`;
  const filePath = path.join(reportsDir, fname);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

/**
 * Corre UNA pasada del ciclo nocturno. No decide CUÁNDO correr (eso es
 * nightCycleDue + el ResidentLoop) — solo hace el trabajo, fail-closed en cada
 * paso metered contra el presupuesto. Nunca lanza por fallos internos de
 * kagemusha/kangeiko (los refleja en el resultado y en el informe) — SÍ lanza
 * si el propio ciclo está desactivado (defensa en profundidad, igual que
 * runKagemusha con su propio gate).
 */
export async function runNightCycle(opts: NightCycleOptions = {}): Promise<NightCycleResult> {
  if (!nightCycleEnabled()) throw new NightCycleDisabledError();

  const now = opts.now ?? (() => Date.now());
  const budgetUsd = opts.budgetUsd ?? nightlyBudgetUsd();
  const ranAt = new Date(now()).toISOString();
  let spentUsd = 0;

  // ── 1. Kagemusha — self-directed ──
  const kagemushaSection: NightCycleResult['kagemusha'] = { ran: false, gaps: 0, threadsInvestigated: 0 };
  if (!kagemushaEnabled()) {
    kagemushaSection.reason = 'KAGEMUSHA_ENABLED no activado — investigación nocturna omitida.';
  } else if (nightBudgetExceeded(spentUsd, budgetUsd)) {
    kagemushaSection.reason = 'presupuesto nocturno agotado antes de empezar (no debería pasar con spentUsd=0, pero fail-closed igual).';
  } else {
    try {
      const runner = opts.kagemushaRunner ?? runKagemusha;
      const result = await runner({
        channels: chooseNightlyChannels(),
        outDir: path.join(appDataShinobiDir(), 'kagemusha_subs'),
        repoRoot: process.cwd(),
        now,
        ...opts.kagemushaOptions,
      });
      const tokenCostUsd = (result.state.tokensSpent / 1000) * USD_PER_1K_KAGEMUSHA_TOKENS;
      spentUsd += tokenCostUsd; // si tokensSpent no fuese finito, contamina spentUsd → el siguiente check para (fail-closed)
      kagemushaSection.ran = true;
      kagemushaSection.reportPath = result.reportPath;
      kagemushaSection.gaps = result.report?.gaps.length ?? 0;
      kagemushaSection.threadsInvestigated = result.state.threadsOpened;
    } catch (e: any) {
      kagemushaSection.reason = `kagemusha falló: ${e?.message ?? e}`;
    }
  }

  // ── 2. Kangeiko — fabrica bajo el tope restante, con el synth REAL ──
  const kangeikoSection: NightCycleResult['kangeiko'] = { attempted: false, certified: false, adopted: false };
  if (nightBudgetExceeded(spentUsd, budgetUsd)) {
    kangeikoSection.reason = 'presupuesto nocturno agotado antes de fabricar — se omite la fabricación de esta noche.';
  } else {
    // Se cobra el intento ANTES de llamar (fail-closed: no gastar de más si el
    // LLM/la jaula se cuelgan; el coste ya quedó reflejado pase lo que pase).
    spentUsd += FABRICATE_ATTEMPT_COST_USD;
    kangeikoSection.attempted = true;

    const prevFlag = process.env.SHINOBI_SYNTH_LLM;
    process.env.SHINOBI_SYNTH_LLM = '1'; // enciende el sintetizador real solo para esta fabricación
    try {
      const synth = opts.synth ?? createDefaultSynthesizer<number, number>();
      const fabResult = await fabricateAsync(NIGHTLY_ORACLE_TASKS, synth);
      kangeikoSection.certified = fabResult.certified;
      if (fabResult.certified) {
        // Certificada por ESTA vía (LLM+jaula) ⇒ por construcción es pura
        // (isolated-vm + scanForbidden ya la dejaron pasar: cero efectos) y
        // el scanner de amenazas ya está limpio (si no lo estuviera, guardedCompile
        // habría lanzado SynthesisRejected antes de llegar a certificar).
        const candidate: AdoptionCandidate = {
          name: `kangeiko_${NIGHTLY_CAPABILITY_ID}_${now()}`,
          description: 'duplicar un número',
          certified: true,
          requestsEffects: false,
          threatScanClean: true,
        };
        const decision = decideAdoption(candidate);
        kangeikoSection.verdict = decision.verdict;
        if (decision.verdict === 'auto_keep') {
          const store = opts.store ?? sharedKangeikoStore();
          store.upsertSkill({
            skill_id: candidate.name,
            capability_id: NIGHTLY_CAPABILITY_ID,
            grade: 'experimental',
            version: 1,
            certified_at: ranAt,
            status: 'active',
          });
          kangeikoSection.adopted = true;
        }
      }
    } catch (e: any) {
      kangeikoSection.reason = `fabricación falló: ${e?.message ?? e}`;
    } finally {
      if (prevFlag === undefined) delete process.env.SHINOBI_SYNTH_LLM;
      else process.env.SHINOBI_SYNTH_LLM = prevFlag;
    }
  }

  const budgetStoppedEarly = nightBudgetExceeded(spentUsd, budgetUsd);
  const partial: Omit<NightCycleResult, 'reportPath'> = {
    ranAt, budgetUsd, spentUsd, budgetStoppedEarly, kagemusha: kagemushaSection, kangeiko: kangeikoSection,
  };
  const reportsDir = opts.reportsDir ?? path.join(appDataShinobiDir(), 'reports');
  const reportPath = writeNightlyReport(reportsDir, partial);

  return { ...partial, reportPath };
}
