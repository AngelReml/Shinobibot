// src/providers/model_id.ts
//
// Bloque 7.1 — normalización de model-ID y saneo de mensajes por proveedor.
//
// Problema medido (sesión de pruebas 2026-06-10): el failover cross-provider
// pasaba el model-ID CRUDO a cualquier cliente donde cayera. Un override como
// `openai/gpt-4o` (convención de prefijo de OpenRouter) llegaba al cliente
// directo de OpenAI, que respondía "invalid model ID" (espera `gpt-4o` a secas)
// → cadena agotada → misión fallida. Además Groq rechazaba el campo `refusal`
// que OpenAI mete en los mensajes assistant ("property 'refusal' is unsupported").
//
// Estas utilidades viven aquí, compartidas por los clientes directos
// (openai/groq/anthropic). OpenRouter NO las usa: sus IDs SON prefijados.

/**
 * Devuelve el model-ID que un cliente DIRECTO debe enviar a su API.
 *   - vacío            → el default del proveedor.
 *   - `<ownPrefix>/x`  → `x` (quita el prefijo propio; p.ej. openai/gpt-4o → gpt-4o).
 *   - `<otro>/x`       → el default del proveedor (el modelo es de OTRO proveedor;
 *                        forzarlo aquí sería un error → degradamos al default propio).
 *   - `x` (sin prefijo)→ `x` tal cual.
 */
export function normalizeModelId(model: string | undefined, ownPrefix: string, fallback: string): string {
  const m = (model || '').trim();
  if (!m) return fallback;
  if (m.startsWith(ownPrefix + '/')) return m.slice(ownPrefix.length + 1);
  if (m.includes('/')) return fallback;
  return m;
}

// Campos que algunos proveedores OpenAI-compatibles (Groq, etc.) NO aceptan en
// los mensajes de entrada aunque OpenAI los EMITA en sus respuestas. Se
// eliminan antes de reenviar el historial.
const ALLOWED_MESSAGE_FIELDS = new Set([
  'role', 'content', 'name', 'tool_calls', 'tool_call_id',
]);

/**
 * Whitelist de campos de cada mensaje. Quita `refusal`, `annotations`, `audio`
 * y cualquier otro extra que OpenAI añade y que rompe a Groq/otros.
 */
export function sanitizeOpenAiMessages(messages: any[]): any[] {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    const clean: any = {};
    for (const k of Object.keys(m)) {
      if (ALLOWED_MESSAGE_FIELDS.has(k)) clean[k] = m[k];
    }
    return clean;
  });
}
