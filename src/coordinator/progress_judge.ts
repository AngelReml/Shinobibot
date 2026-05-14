/**
 * Progress Judge — evalúa cuánto se ha acercado el agente a su objetivo
 * declarado tras cada turno. Es la capa 3 del loop detector (Sprint 2.1)
 * que complementa las dos capas heurísticas existentes (args SHA256 y
 * output fingerprint).
 *
 * Diseño:
 *
 *  - El judge es un MODELO INDEPENDIENTE del agente principal. No
 *    participa en la conversación; solo emite scores 0–1 representando
 *    "qué fracción del objetivo se ha cumplido a juicio del judge".
 *
 *  - Por defecto el judge es `groq llama-3.3-70b` (barato, rápido, free
 *    tier suficiente para 1–2 evaluaciones por minuto). Configurable
 *    via `SHINOBI_PROGRESS_JUDGE` (formato `provider:model`).
 *
 *  - El detector usa una ventana móvil de scores: si los últimos
 *    `windowSize` (default 3) scores no muestran progreso ≥ `minDelta`
 *    (default 0.05) y al menos un score es < 0.85, dispara
 *    `NO_SEMANTIC_PROGRESS`. Esto cubre el caso en que el agente "pasa
 *    el rato" en una zona sin acercarse al final.
 *
 *  - **Default OFF**: el judge cuesta tokens. Solo se activa cuando el
 *    operador set `SHINOBI_PROGRESS_DETECTION=1`. Mientras esté off, el
 *    loop detector v2 dual-layer sigue funcionando intacto.
 *
 *  - **Cumple la regla "no cambiar modelo bajo medición sin notificar"**:
 *    el judge es un modelo DISTINTO del que ejecuta la tarea. La elección
 *    del judge se logea explícitamente.
 */

export interface ProgressJudge {
  readonly id: string;
  /**
   * Devuelve un score 0–1 donde 1 = objetivo completado, 0 = nada hecho.
   * El judge ve el goal y el output más reciente del agente. NO ve toda
   * la conversación para mantener el coste bajo.
   */
  score(goal: string, latestOutput: string): Promise<number>;
}

export interface JudgeOptions {
  judge?: ProgressJudge;
  /** Tamaño de la ventana móvil de scores. */
  windowSize?: number;
  /** Delta mínimo positivo entre primer y último score de la ventana. */
  minDelta?: number;
  /** Score por encima del cual ya consideramos "casi hecho" — no abortamos. */
  doneThreshold?: number;
}

export interface ProgressHistoryEntry {
  ts: string;
  score: number;
  iterationOutput: string; // truncated
}

export interface ProgressCheckResult {
  abort: boolean;
  verdict?: 'NO_SEMANTIC_PROGRESS';
  reason?: string;
  latestScore: number;
  history: ProgressHistoryEntry[];
}

const DEFAULTS: Required<Omit<JudgeOptions, 'judge'>> = {
  windowSize: 3,
  minDelta: 0.05,
  doneThreshold: 0.85,
};

/**
 * Judge basado en LLM real via provider_router. Es el judge "real" que
 * se usaría en producción cuando `SHINOBI_PROGRESS_DETECTION=1`.
 *
 * El modelo se elige con `SHINOBI_PROGRESS_JUDGE` (formato
 * `provider:model`, default `groq:llama-3.3-70b-versatile`).
 */
export class LLMProgressJudge implements ProgressJudge {
  readonly id: string;
  private readonly providerHint: string;
  private readonly modelHint: string;

  constructor() {
    const raw = (process.env.SHINOBI_PROGRESS_JUDGE || 'groq:llama-3.3-70b-versatile').trim();
    const idx = raw.indexOf(':');
    if (idx > 0) {
      this.providerHint = raw.slice(0, idx);
      this.modelHint = raw.slice(idx + 1);
    } else {
      this.providerHint = 'groq';
      this.modelHint = raw;
    }
    this.id = `llm:${this.providerHint}/${this.modelHint}`;
  }

  async score(goal: string, latestOutput: string): Promise<number> {
    const truncatedOutput = latestOutput.length > 4000 ? latestOutput.slice(0, 4000) + '…' : latestOutput;
    const prompt = [
      'You are a strict progress judge for an autonomous agent. Read the goal and the agent\'s latest action output.',
      'Return ONLY a JSON object {"progress": 0.0-1.0} where 1.0 = goal fully accomplished, 0.5 = halfway, 0.0 = no progress.',
      'Do not include any other text.',
      '',
      `GOAL: ${goal}`,
      '',
      `LATEST OUTPUT: ${truncatedOutput}`,
    ].join('\n');

    // Lazy import del provider_router para evitar circular deps.
    const { invokeLLM } = await import('../providers/provider_router.js');
    const result = await invokeLLM({
      messages: [{ role: 'user', content: prompt }],
      model: this.modelHint,
      temperature: 0,
    } as any);
    if (!result.success || !result.output) return 0;
    try {
      const msg = JSON.parse(result.output);
      const content = String(msg?.content ?? '');
      const m = content.match(/\{[^}]*\"progress\"\s*:\s*([01](?:\.\d+)?)/);
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
      }
    } catch {
      // ignore
    }
    return 0;
  }
}

/** Judge sintético para tests: devuelve scores scripted. */
export class MockProgressJudge implements ProgressJudge {
  readonly id = 'mock';
  private readonly scores: number[];
  private idx = 0;

  constructor(scores: number[]) {
    this.scores = scores;
  }

  async score(_goal: string, _output: string): Promise<number> {
    if (this.idx >= this.scores.length) return this.scores[this.scores.length - 1] ?? 0;
    return this.scores[this.idx++];
  }
}

/**
 * Acumula scores y decide cuándo abortar por falta de progreso semántico.
 */
export class ProgressTracker {
  private readonly history: ProgressHistoryEntry[] = [];
  private readonly cfg: Required<Omit<JudgeOptions, 'judge'>>;
  private readonly judge: ProgressJudge;

  constructor(opts: JudgeOptions = {}) {
    this.cfg = {
      windowSize: opts.windowSize ?? DEFAULTS.windowSize,
      minDelta: opts.minDelta ?? DEFAULTS.minDelta,
      doneThreshold: opts.doneThreshold ?? DEFAULTS.doneThreshold,
    };
    this.judge = opts.judge ?? new LLMProgressJudge();
  }

  judgeId(): string {
    return this.judge.id;
  }

  history_snapshot(): ProgressHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Registra el output de la iteración actual, pide score al judge y
   * decide si hay que abortar.
   */
  async recordIteration(goal: string, iterationOutput: string): Promise<ProgressCheckResult> {
    const score = await this.judge.score(goal, iterationOutput);
    this.history.push({
      ts: new Date().toISOString(),
      score,
      iterationOutput: iterationOutput.length > 200 ? iterationOutput.slice(0, 200) + '…' : iterationOutput,
    });
    return this.evaluate();
  }

  /**
   * Versión sync para inyectar scores ya calculados (útil en tests sin red).
   */
  recordScore(score: number, label?: string): ProgressCheckResult {
    this.history.push({
      ts: new Date().toISOString(),
      score,
      iterationOutput: label ?? '',
    });
    return this.evaluate();
  }

  private evaluate(): ProgressCheckResult {
    const last = this.history[this.history.length - 1]?.score ?? 0;
    if (this.history.length < this.cfg.windowSize) {
      return { abort: false, latestScore: last, history: [...this.history] };
    }
    const window = this.history.slice(-this.cfg.windowSize);
    const firstInWindow = window[0].score;
    const lastInWindow = window[window.length - 1].score;
    const delta = lastInWindow - firstInWindow;
    // Si ya estamos "casi hecho", no abortamos aunque el delta sea mínimo.
    if (lastInWindow >= this.cfg.doneThreshold) {
      return { abort: false, latestScore: last, history: [...this.history] };
    }
    if (delta < this.cfg.minDelta) {
      return {
        abort: true,
        verdict: 'NO_SEMANTIC_PROGRESS',
        reason: `windowDelta=${delta.toFixed(3)} < minDelta=${this.cfg.minDelta} (window: ${window.map(w => w.score.toFixed(2)).join(' → ')})`,
        latestScore: last,
        history: [...this.history],
      };
    }
    return { abort: false, latestScore: last, history: [...this.history] };
  }
}

export function progressDetectionEnabled(): boolean {
  return process.env.SHINOBI_PROGRESS_DETECTION === '1';
}
