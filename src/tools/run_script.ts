/**
 * run_script — un programa corto que usa las tools (mejora tomada de Hermes
 * Agent: «execute_code» con llamadas a herramientas).
 *
 * Para trabajos de «mirar muchas cosas y quedarse con poco» (leer 30
 * ficheros y contar algo, cruzar varias búsquedas) el agente gastaba un paso
 * del modelo por cada tool y metía todos los resultados en el historial. Con
 * `run_script` escribe un JavaScript corto que llama a las tools en bucle y
 * devuelve solo el resumen: un paso en vez de treinta.
 *
 * SEGURIDAD — el script lo escribe el modelo, así que se trata como código
 * ajeno:
 *  - Corre en un isolate `isolated-vm` nuevo (sin require, sin fs, sin red,
 *    sin process), con tope de memoria y de tiempo.
 *  - Su ÚNICA puerta al exterior es `tools.call(nombre, args)`, y solo hacia
 *    tools de SOLO LECTURA (lista blanca). Escribir, borrar o ejecutar
 *    comandos sigue exigiendo una llamada normal, con su aprobación.
 *  - Tope de llamadas y de tamaño de salida.
 */
import ivm from 'isolated-vm';
import { type Tool, type ToolResult, registerTool, getTool } from './tool_registry.js';
import { READ_ONLY_TOOLS } from '../security/approval.js';

export const SCRIPT_MAX_CODE_CHARS = 20_000;
export const SCRIPT_MAX_TOOL_CALLS = 60;
export const SCRIPT_MAX_OUTPUT_CHARS = 20_000;
export const SCRIPT_DEFAULT_TIMEOUT_MS = 60_000;
const SCRIPT_MAX_TIMEOUT_MS = 300_000;
const SCRIPT_MAX_TOOL_RESULT_CHARS = 200_000;

/** Tools que un script puede llamar: las de solo lectura del gate + dos internas inocuas. */
export function scriptAllowedTools(): Set<string> {
  return new Set<string>([...READ_ONLY_TOOLS, 'session_search', 'todo']);
}

export type ToolCaller = (name: string, args: any) => Promise<ToolResult>;

const defaultCaller: ToolCaller = async (name, args) => {
  const t = getTool(name);
  if (!t) return { success: false, output: '', error: `la tool "${name}" no existe` };
  if (t.requiresConfirmation?.(args)) return { success: false, output: '', error: `"${name}" con esos argumentos requiere confirmación del usuario y no puede llamarse desde un script` };
  return t.execute(args);
};

export interface ScriptRun { ok: boolean; output: string; error?: string; toolCalls: number }

export async function runScript(
  code: string,
  opts: { timeoutMs?: number; call?: ToolCaller; allowed?: Set<string> } = {},
): Promise<ScriptRun> {
  const call = opts.call ?? defaultCaller;
  const allowed = opts.allowed ?? scriptAllowedTools();
  const timeoutMs = Math.max(100, Math.min(SCRIPT_MAX_TIMEOUT_MS, opts.timeoutMs ?? SCRIPT_DEFAULT_TIMEOUT_MS));
  let toolCalls = 0;
  const printed: string[] = [];
  let printedChars = 0;

  const isolate = new ivm.Isolate({ memoryLimit: 64 });
  let timer: NodeJS.Timeout | undefined;
  try {
    const context = await isolate.createContext();
    const jail = context.global;

    await jail.set('__print', new ivm.Reference((s: string) => {
      if (printedChars >= SCRIPT_MAX_OUTPUT_CHARS) return;
      const line = String(s).slice(0, SCRIPT_MAX_OUTPUT_CHARS - printedChars);
      printed.push(line); printedChars += line.length + 1;
    }));
    await jail.set('__call', new ivm.Reference(async (name: string, argsJson: string) => {
      const toolName = String(name);
      if (!allowed.has(toolName)) {
        return JSON.stringify({ success: false, output: '', error: `"${toolName}" no está permitida en un script (solo lectura: ${[...allowed].join(', ')})` });
      }
      if (++toolCalls > SCRIPT_MAX_TOOL_CALLS) {
        return JSON.stringify({ success: false, output: '', error: `tope de ${SCRIPT_MAX_TOOL_CALLS} llamadas a tools por script alcanzado` });
      }
      let args: any = {};
      try { args = JSON.parse(String(argsJson || '{}')); } catch { /* args vacíos */ }
      try {
        const r = await call(toolName, args);
        return JSON.stringify({ success: !!r?.success, output: String(r?.output ?? '').slice(0, SCRIPT_MAX_TOOL_RESULT_CHARS), error: r?.error ? String(r.error).slice(0, 2000) : undefined });
      } catch (e: any) {
        return JSON.stringify({ success: false, output: '', error: String(e?.message ?? e).slice(0, 2000) });
      }
    }));

    // Las referencias al anfitrión quedan dentro de un cierre: el script no
    // puede nombrarlas. (Aunque pudiera, la lista blanca se aplica en el lado
    // del anfitrión, no aquí.)
    await context.eval(`(() => {
      const __p = globalThis.__print, __c = globalThis.__call;
      delete globalThis.__print; delete globalThis.__call;
      const __fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
      globalThis.print = (...a) => { __p.applySync(undefined, [a.map(__fmt).join(' ')]); };
      globalThis.console = { log: globalThis.print, warn: globalThis.print, error: globalThis.print, info: globalThis.print };
      globalThis.tools = Object.freeze({
        call: async (name, args) => JSON.parse(await __c.apply(undefined, [String(name), JSON.stringify(args ?? {})], { result: { promise: true } })),
      });
    })();`);

    const wrapped = `(async () => {\n${code}\n})().then(v => v === undefined ? '' : (typeof v === 'string' ? v : JSON.stringify(v)))`;
    const script = await isolate.compileScript(wrapped, { filename: 'run_script.js' });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try { isolate.dispose(); } catch { /* ya liberado */ }
        reject(new Error(`el script superó ${Math.round(timeoutMs / 1000)}s y se detuvo`));
      }, timeoutMs);
    });
    const returned = await Promise.race([script.run(context, { timeout: timeoutMs, promise: true }), timeout]);
    const parts = [...printed];
    if (returned) parts.push(String(returned));
    const output = parts.join('\n').slice(0, SCRIPT_MAX_OUTPUT_CHARS);
    return { ok: true, output: output || '(el script no devolvió ni imprimió nada)', toolCalls };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const partial = printed.join('\n').slice(0, 2000);
    return { ok: false, output: partial, error: /disposed|Isolate was disposed/i.test(msg) ? `el script superó ${Math.round(timeoutMs / 1000)}s y se detuvo` : msg.slice(0, 2000), toolCalls };
  } finally {
    if (timer) clearTimeout(timer);
    try { if (!isolate.isDisposed) isolate.dispose(); } catch { /* ya liberado */ }
  }
}

const tool: Tool = {
  name: 'run_script',
  description:
    'Run a short JavaScript program that calls READ-ONLY tools in a loop and returns only a summary. Use it when a job needs many lookups whose raw results you do not need to keep ' +
    '(read 30 files and count something, cross several searches): one step instead of thirty. ' +
    'Inside the script: `await tools.call(name, args)` returns {success, output, error}; `print(...)` adds a line to the result; `return value` ends it. ' +
    'No require, no filesystem, no network, no process: tools.call is the only way out, and only read-only tools are allowed ' +
    '(read_file, list_dir, search_files, web_search, browser_observe, screen_observe, skill_list, session_search, todo). ' +
    `Limits: ${SCRIPT_MAX_TOOL_CALLS} tool calls, ${SCRIPT_DEFAULT_TIMEOUT_MS / 1000}s, ${SCRIPT_MAX_OUTPUT_CHARS} chars of output. To write, edit or run commands, use those tools directly.`,
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript (async body). Example: const r = await tools.call("list_dir", {path:"src"}); return r.output.split("\\n").length;' },
      timeout_seconds: { type: 'number', description: 'Wall-clock limit, default 60, max 300.' },
    },
    required: ['code'],
  },
  categories: ['code'],

  async execute(args: { code: string; timeout_seconds?: number }): Promise<ToolResult> {
    const code = String(args?.code ?? '');
    if (!code.trim()) return { success: false, output: '', error: 'falta "code"' };
    if (code.length > SCRIPT_MAX_CODE_CHARS) return { success: false, output: '', error: `script demasiado largo (máx. ${SCRIPT_MAX_CODE_CHARS} caracteres)` };
    const t = Number(args?.timeout_seconds);
    const r = await runScript(code, { timeoutMs: Number.isFinite(t) && t > 0 ? t * 1000 : undefined });
    const tail = `\n[${r.toolCalls} llamada(s) a tools]`;
    return r.ok
      ? { success: true, output: r.output + tail }
      : { success: false, output: r.output, error: `${r.error}${tail}` };
  },
};

registerTool(tool);
export default tool;
