/**
 * Model Router — decide qué modelo invocar antes de cada turno del LLM,
 * basado en la complejidad heurística de la query (`classifyComplexity`).
 *
 * Sprint 1.5: complementa el mapping por ROL existente (architect=opus,
 * security=opus, ux=sonnet en src/committee/). Aquí el routing es por
 * la query individual del usuario en el orchestrator normal.
 *
 * Default OFF: el router está disponible pero NO se activa hasta que el
 * operador set `SHINOBI_MODEL_ROUTER=1`. Mientras esté off, devuelve un
 * verdict "passthrough" que indica "usa el modelo actual sin cambio".
 *
 * Mapping default por tier (ajustable via env per-tier):
 *
 *   tier      provider     model                  ~$/1M tokens (combined)
 *   tiny      groq         llama-3.3-70b-versatile  ~$0.6
 *   simple    groq         llama-3.3-70b-versatile  ~$0.6
 *   medium    anthropic    claude-haiku-4.5         ~$1.4
 *   complex   anthropic    claude-sonnet-4.6        ~$15
 *   expert    anthropic    claude-opus-4.7          ~$50
 *
 * El router NO cambia el modelo a mitad de medición — solo registra la
 * decisión antes de cada turno. Eso preserva la regla del usuario "no
 * cambiar modelo bajo medición sin notificar".
 */

import { classifyComplexity, type ComplexityTier, type ComplexityResult } from './query_complexity.js';

export interface ModelChoice {
  provider: string;   // 'groq' | 'openai' | 'anthropic' | 'openrouter' | 'opengravity'
  model: string;      // identificador en el provider
}

export interface RouteDecision {
  enabled: boolean;
  tier: ComplexityTier;
  choice: ModelChoice;
  complexity: ComplexityResult;
  rationale: string[];
  /** Coste estimado (combinado input+output) en USD por esta query. */
  estimatedCostUsd: number;
}

export interface RouteOptions {
  /** Texto del input del usuario. */
  input: string;
  /** Últimos N inputs del usuario para contexto. */
  recentUserTurns?: string[];
  /** Override del modelo actual (lo que estaba usando antes del router). */
  currentModel?: ModelChoice;
}

/** Precios aproximados por 1M tokens combinados (input+output averaged). */
const PRICE_PER_1M: Record<string, number> = {
  'groq/llama-3.3-70b-versatile': 0.6,
  'groq/llama-3.1-8b-instant': 0.1,
  'anthropic/claude-haiku-4.5': 1.4,
  'anthropic/claude-sonnet-4.6': 15.0,
  'anthropic/claude-opus-4.7': 50.0,
  'openai/gpt-4o-mini': 0.25,
  'openai/gpt-4o': 12.5,
};

const DEFAULT_MAPPING: Record<ComplexityTier, ModelChoice> = {
  tiny:    { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
  simple:  { provider: 'groq',      model: 'llama-3.3-70b-versatile' },
  medium:  { provider: 'anthropic', model: 'claude-haiku-4.5' },
  complex: { provider: 'anthropic', model: 'claude-sonnet-4.6' },
  expert:  { provider: 'anthropic', model: 'claude-opus-4.7' },
};

function readEnvOverride(tier: ComplexityTier): ModelChoice | null {
  const key = `SHINOBI_ROUTER_${tier.toUpperCase()}`;
  const raw = process.env[key];
  if (!raw || typeof raw !== 'string') return null;
  // Formato: "provider:model" o "model" (entonces hereda provider del default).
  const idx = raw.indexOf(':');
  if (idx > 0) {
    return { provider: raw.slice(0, idx).trim(), model: raw.slice(idx + 1).trim() };
  }
  return { provider: DEFAULT_MAPPING[tier].provider, model: raw.trim() };
}

export function isRouterEnabled(): boolean {
  return process.env.SHINOBI_MODEL_ROUTER === '1';
}

export function pickModelForTier(tier: ComplexityTier): ModelChoice {
  return readEnvOverride(tier) ?? DEFAULT_MAPPING[tier];
}

function estimateCostUsd(choice: ModelChoice, inputTokens: number, expectedOutputTokens: number): number {
  const key = `${choice.provider}/${choice.model}`;
  const pricePerM = PRICE_PER_1M[key];
  if (!pricePerM) return 0; // modelo desconocido, no inventamos coste
  const total = inputTokens + expectedOutputTokens;
  return (total * pricePerM) / 1_000_000;
}

export function route(opts: RouteOptions): RouteDecision {
  const complexity = classifyComplexity(opts.input, { recentUserTurns: opts.recentUserTurns });
  const enabled = isRouterEnabled();
  const tier = complexity.tier;
  const choice = enabled
    ? pickModelForTier(tier)
    : (opts.currentModel ?? DEFAULT_MAPPING.medium);
  const rationale: string[] = enabled
    ? [`router=ON`, `tier=${tier}`, ...complexity.signals.slice(0, 3)]
    : [`router=OFF (set SHINOBI_MODEL_ROUTER=1 to enable)`, `tier=${tier}`];
  // Estimación coste: output esperado escala con tier (heurística).
  const expectedOutput = tier === 'tiny' ? 100
    : tier === 'simple' ? 400
    : tier === 'medium' ? 1500
    : tier === 'complex' ? 4000
    : 8000;
  const estimatedCostUsd = estimateCostUsd(choice, complexity.estimatedInputTokens, expectedOutput);
  return {
    enabled,
    tier,
    choice,
    complexity,
    rationale,
    estimatedCostUsd,
  };
}

export { DEFAULT_MAPPING, PRICE_PER_1M };
