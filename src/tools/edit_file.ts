/**
 * EditFile Tool — Partial file modification via search & replace
 * Inspired by Claude Code's FileEditTool
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';
import { resolveInContext } from '../agents/exec_context.js';
import { runDiagnostics, formatDiagnostics, lspOnWriteEnabled, lspSemanticEnabled } from '../lsp/diagnostics.js';

/**
 * BAJA-02 — mutex en memoria por ruta de archivo normalizada.
 *
 * `edit_file` hace read-modify-write sin locking: si dos sub-agentes del
 * swarm editan el MISMO archivo en paralelo (mismo proceso Node), ambos leen
 * el contenido viejo, y el último `writeFileSync` gana silenciosamente,
 * perdiendo el cambio del otro. Inspirado en el patrón `runExclusive` de
 * `src/coordinator/orchestrator_mutex.ts`, pero clave por ruta en vez de
 * global: encadena las operaciones sobre la MISMA ruta y deja en paralelo
 * las de rutas distintas. Esto NO resuelve ediciones concurrentes desde
 * PROCESOS distintos (requeriría file locking real a nivel OS, fuera de
 * alcance aquí) — sí resuelve el caso real del swarm interno.
 */
const pathChains = new Map<string, Promise<unknown>>();

function runExclusiveForPath<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const prev = pathChains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn());
  // La cola avanza pase lo que pase con `run` (éxito o error), y libera la
  // entrada del Map cuando no queda nada encolado para no crecer sin límite.
  const tail = run.then(() => undefined, () => undefined);
  pathChains.set(key, tail);
  tail.then(() => {
    if (pathChains.get(key) === tail) pathChains.delete(key);
  });
  return run;
}

const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing an exact text match with new content. The target text must appear exactly once in the file. Use read_file first to see the current content.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      target: { type: 'string', description: 'The exact text to find and replace (must be unique in the file)' },
      replacement: { type: 'string', description: 'The text to replace the target with' },
    },
    required: ['path', 'target', 'replacement'],
  },

  async execute(args: { path: string; target: string; replacement: string }): Promise<ToolResult> {
    const filePath = resolveInContext(args.path);
    const check = validatePath(filePath, 'write');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    // BAJA-02: todo el read-modify-write va dentro del mutex por ruta para
    // que dos ediciones concurrentes sobre el MISMO archivo (swarm) se
    // serialicen en vez de pisarse — ver `runExclusiveForPath` arriba.
    return runExclusiveForPath(filePath, async () => {
      if (!fs.existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const occurrences = content.split(args.target).length - 1;

      if (occurrences === 0) {
        return { success: false, output: '', error: `Target text not found in ${filePath}. Use read_file to verify the exact content.` };
      }
      if (occurrences > 1) {
        return { success: false, output: '', error: `Target text found ${occurrences} times in ${filePath}. It must be unique. Use a longer/more specific target.` };
      }

      // ALTA-03: `String.prototype.replace(string, string)` SÍ interpreta
      // patrones especiales ($&, $`, $', $1...) en el argumento de REEMPLAZO
      // aunque el primer argumento sea un string literal y no una regex. El
      // LLM controla `args.replacement`; con `$'` podía corromper/duplicar
      // contenido del archivo silenciosamente. `split(target).join(replacement)`
      // trata `replacement` como texto literal puro. Como arriba ya rechazamos
      // `occurrences !== 1`, sabemos que `target` aparece EXACTAMENTE una vez,
      // así que split/join reemplaza esa única ocurrencia — mismo resultado que
      // el `replace` original, sin la interpretación de patrones `$`.
      const newContent = content.split(args.target).join(args.replacement);
      fs.writeFileSync(filePath, newContent, 'utf-8');

      let output = `Edited ${filePath}: replaced ${args.target.split('\n').length} lines with ${args.replacement.split('\n').length} lines.`;

      // LSP-flavored (opt-in SHINOBI_LSP=1): diagnostica el resultado de la edición.
      if (lspOnWriteEnabled()) {
        try {
          const diags = await runDiagnostics(filePath, newContent, { semantic: lspSemanticEnabled() });
          if (diags.length > 0) output += `\n${formatDiagnostics(diags)}`;
        } catch { /* best-effort */ }
      }

      return { success: true, output };
    });
  },
};

registerTool(editFileTool);
export default editFileTool;
