/**
 * Límite duro de tamaño para tool outputs individuales ANTES de que entren al
 * contexto. El compactor actúa sobre el historial ya acumulado; este módulo
 * actúa en el instante en que un tool output se va a añadir al array de
 * mensajes, impidiendo que un único output gigante (p.ej. read_file de archivo
 * extenso) supere el límite del proveedor aunque el historial sea corto.
 *
 * Estrategia: head (60 %) + tail (20 %) + marker central indicando al LLM
 * cómo pedir el resto con read_file + startLine/endLine.
 */

/** Máximo de chars por tool output individual (env-configurable). ~8 000 tokens. */
export const TOOL_OUTPUT_MAX_CHARS =
  Number(process.env.SHINOBI_TOOL_OUTPUT_MAX_CHARS) || 32_000;

const HEAD_RATIO = 0.6;
const TAIL_RATIO = 0.2;

/**
 * Trunca `output` si supera `maxChars`, conservando principio y final e
 * insertando un marker que indica al LLM cómo pedir el contenido omitido.
 */
export function truncateToolOutput(
  output: string,
  maxChars: number = TOOL_OUTPUT_MAX_CHARS,
): string {
  if (!output || output.length <= maxChars) return output;
  const keepHead = Math.floor(maxChars * HEAD_RATIO);
  const keepTail = Math.floor(maxChars * TAIL_RATIO);
  const omitted = output.length - keepHead - keepTail;
  const marker =
    `\n[... contenido truncado: ${omitted} caracteres omitidos. ` +
    `Usa read_file con startLine/endLine para leer secciones específicas ...]\n`;
  return output.slice(0, keepHead) + marker + output.slice(output.length - keepTail);
}

/**
 * Aplica el cap a `toolResultStr` (JSON serializado del ToolResult).
 * Parsea el JSON, trunca el campo `output` si es necesario y re-serializa.
 * Si el JSON no es parseable (raro), trunca el string crudo como fallback.
 * Devuelve la cadena (posiblemente truncada) y un flag indicando si se truncó.
 */
export function capToolResultJson(
  toolResultStr: string,
  maxChars: number = TOOL_OUTPUT_MAX_CHARS,
): { result: string; truncated: boolean } {
  if (toolResultStr.length <= maxChars) return { result: toolResultStr, truncated: false };

  try {
    const parsed = JSON.parse(toolResultStr) as Record<string, unknown>;
    if (typeof parsed?.output === 'string' && parsed.output.length > maxChars) {
      const capped = truncateToolOutput(parsed.output, maxChars);
      return {
        result: JSON.stringify({ ...parsed, output: capped }),
        truncated: true,
      };
    }
  } catch {
    // JSON inválido (no debería ocurrir) — truncar el string raw como fallback
    return {
      result: truncateToolOutput(toolResultStr, maxChars),
      truncated: true,
    };
  }
  return { result: toolResultStr, truncated: false };
}
