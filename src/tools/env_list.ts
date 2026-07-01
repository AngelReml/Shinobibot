/**
 * Env List — lista variables de entorno con redacción automática de
 * valores sensibles (API keys, tokens, passwords). Read-only.
 *
 * Política (F2.7, auditoría 2026-07): la redacción tenía un hueco real —
 * antes SOLO se redactaba por NOMBRE de variable (heurística de
 * SENSITIVE_NAME_PATTERNS). Una variable con nombre atípico que contuviera
 * un secreto embebido (p. ej. una connection string con password en la URL,
 * bajo una variable llamada `DB_HOST` en vez de `DB_URL`) pasaba sin
 * redactar. Ahora se redactan AMBAS cosas: (1) por nombre, como antes
 * (`<REDACTED>` — heurística barata, cero falsos negativos de nombre) y
 * (2) por CONTENIDO, pasando cada valor por `secret_redactor` (reusa el
 * mismo catálogo de patrones que audita `run_command`/`code_reviewer`, no
 * uno propio — un solo catálogo de secretos en todo el repo, ver F2.7).
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { redactSecrets } from '../security/secret_redactor.js';

const SENSITIVE_NAME_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /pwd/i,
  /credential/i,
  /auth/i,
  /api_/i,
];

function shouldRedact(name: string): boolean {
  return SENSITIVE_NAME_PATTERNS.some(p => p.test(name));
}

const tool: Tool = {
  name: 'env_list',
  description: 'List Windows environment variables. Values matching sensitive name patterns (key, token, secret, password, credential, auth, api_*) are automatically redacted. Optionally filter by name substring.',
  parameters: {
    type: 'object',
    properties: {
      nameFilter: { type: 'string', description: 'Optional case-insensitive substring to filter variable names.' },
    },
    required: [],
  },

  async execute(args: { nameFilter?: string }): Promise<ToolResult> {
    const filter = args.nameFilter?.toLowerCase();
    const out: Array<{ name: string; value: string }> = [];
    for (const [name, raw] of Object.entries(process.env)) {
      if (filter && !name.toLowerCase().includes(filter)) continue;
      const value = raw ?? '';
      let display: string;
      if (shouldRedact(name)) {
        // Heurística de nombre: redacción total, sin exponer ni longitud
        // (comportamiento previo, sin cambios — cero falsos negativos de
        // nombre).
        display = '<REDACTED>';
      } else {
        // F2.7: aunque el NOMBRE no parezca sensible, el CONTENIDO puede
        // serlo (connection string con password embebida, token pegado a
        // mano en una var con nombre atípico, etc.). Pasa por el mismo
        // catálogo de patrones que el resto del repo.
        const { text: contentRedacted, matches } = redactSecrets(value);
        display = matches.length > 0
          ? contentRedacted
          : value.length > 200
            ? `${value.slice(0, 200)}…[truncado ${value.length - 200} chars]`
            : value;
      }
      out.push({ name, value: display });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, output: JSON.stringify(out) };
  },
};

registerTool(tool);
export default tool;
