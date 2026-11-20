// src/coordinator/pricing.ts
//
// Tarifas de los modelos de Anthropic (USD por millón de tokens), para que el
// coste que enseña Shinobi sea una ESTIMACIÓN con base y no una cifra antigua.
// Comprobadas el 20-nov-2026 contra la página de precios de Anthropic y prensa
// del sector; las tarifas cambian, así que el número exacto es el de tu
// factura. `cacheRead` y `cacheWrite` son multiplicadores sobre la entrada.

export interface ModelRate {
  input: number;
  output: number;
  /** Lectura de caché, × tarifa de entrada. */
  cacheRead: number;
  /** Escritura de caché de 5 min, × tarifa de entrada. */
  cacheWrite: number;
}

const R = (input: number, output: number, cacheRead: number, cacheWrite = 1.25): ModelRate => ({ input, output, cacheRead, cacheWrite });

/**
 * Tarifa de un modelo de Anthropic por su id. El orden importa: lo más
 * específico primero. Un id desconocido cae en la tarifa de su familia.
 */
export function anthropicRate(model: string, promptTokens = 0): ModelRate {
  const m = model.toLowerCase();
  if (m.includes('fable-5-1') || m.includes('mythos-5-1')) return R(10, 50, 0.025);
  if (m.includes('fable') || m.includes('mythos')) return R(8, 40, 0.025);
  if (m.includes('opus-5-5')) return R(4, 20, 0.05);
  if (m.includes('opus')) return R(5, 25, 0.1); // Opus 5, 4.8 y anteriores
  if (m.includes('sonnet-5-5')) return R(2, 10, 0.05);
  if (m.includes('sonnet')) return R(3, 15, 0.1);
  // Haiku 5.5: dos tramos según el tamaño del prompt (hasta / más de 100.000 tokens).
  if (m.includes('haiku-5-5')) return promptTokens > 100_000 ? R(0.5, 2.5, 0.1) : R(0.1, 0.5, 0.1);
  if (m.includes('haiku')) return R(1, 5, 0.1);
  return R(3, 15, 0.1);
}
