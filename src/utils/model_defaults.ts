/**
 * Canonical Anthropic model identifiers (single source of truth).
 *
 * Rule: Anthropic model IDs use dashes exclusively — never dots.
 *   CORRECT:   claude-haiku-4-5
 *   INCORRECT: claude-haiku-4.5   ← rejected by the API
 *
 * OpenRouter passes models as `anthropic/<model-id>` (prefix + dash form).
 * All constants here follow this convention.
 */

// ── Anthropic native IDs ──────────────────────────────────────────────────────
export const ANTHROPIC_MODEL_HAIKU  = 'claude-haiku-4-5'   as const;
export const ANTHROPIC_MODEL_SONNET = 'claude-sonnet-4-6'  as const;
export const ANTHROPIC_MODEL_OPUS   = 'claude-opus-4-8'    as const;

// ── OpenRouter routing IDs (anthropic/<model-id>) ────────────────────────────
export const OPENROUTER_MODEL_HAIKU  = `anthropic/${ANTHROPIC_MODEL_HAIKU}`  as const;
export const OPENROUTER_MODEL_SONNET = `anthropic/${ANTHROPIC_MODEL_SONNET}` as const;
export const OPENROUTER_MODEL_OPUS   = `anthropic/${ANTHROPIC_MODEL_OPUS}`   as const;

// ── Defaults ──────────────────────────────────────────────────────────────────
/** Default for Anthropic-native clients (anthropic_client.ts, refiner, etc.). */
export const DEFAULT_ANTHROPIC_MODEL   = ANTHROPIC_MODEL_HAIKU;
/** Default for OpenRouter-routed calls (openrouter_client.ts, openrouter_fallback.ts, etc.). */
export const DEFAULT_OPENROUTER_MODEL  = OPENROUTER_MODEL_HAIKU;
