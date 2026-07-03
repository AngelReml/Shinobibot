/**
 * Tool Registry — Central hub for all Shinobi tools
 * Inspired by Claude Code's tool system (src/tools.ts)
 */

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute(args: any): Promise<ToolResult>;
  /** Return true if this tool call needs user confirmation before running */
  requiresConfirmation?(args: any): boolean;
  categories?: string[];
}

/** Convert a Shinobi Tool to OpenAI function-calling format */
export function toOpenAITools(tools: Tool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * ALTA-02 (auditoría 2026-06-30, sandboxing cerrado 2026-07-03): origen de un
 * tool registrado. 'native' son los built-in cargados por src/tools/index.ts
 * al arrancar; 'plugin' son los traídos por un plugin de terceros vía
 * src/plugins/plugin_loader.ts, que ahora evalúa el entry confinado en un
 * isolate `isolated-vm` (via `buildSandboxedTool`) tras pasar el guard AST
 * `scanForbidden`. Esta distinción de origen sigue siendo necesaria como
 * segunda capa: sin ella, un plugin podía registrar p.ej. `run_command` y
 * reemplazar en silencio el nativo, tirando todos sus checks de seguridad.
 */
export type ToolSource = 'native' | 'plugin';

/**
 * Contexto ambiente de carga, fijado por quien dispara la carga de un
 * módulo de tools (hoy: plugin_loader.ts alrededor de `importPlugin`). Así
 * registerTool() sabe el origen de la llamada SIN cambiar la firma que ya
 * usan los ~57 archivos de tools nativos (todos llaman `registerTool(tool)`
 * a secas al cargarse). Default 'native': cualquier código que no pase por
 * el loader de plugins se asume nativo/de confianza.
 */
let _loadSource: ToolSource = 'native';
export function setToolLoadSource(source: ToolSource): void {
  _loadSource = source;
}
export function getToolLoadSource(): ToolSource {
  return _loadSource;
}

/** Registry singleton */
const _tools: Map<string, Tool> = new Map();
const _toolSources: Map<string, ToolSource> = new Map();

/** Origen con el que se registró `name`, si existe. Útil para diagnóstico/tests. */
export function getToolSource(name: string): ToolSource | undefined {
  return _toolSources.get(name);
}

export function registerTool(tool: Tool) {
  if (!tool.categories) {
    if (['read_file', 'grep', 'view_outline', 'list_dir', 'search_files'].includes(tool.name)) {
      tool.categories = ['research', 'coder'];
    } else if (['write_file', 'edit_file_patch', 'edit_file', 'run_command'].includes(tool.name)) {
      tool.categories = ['coder'];
    } else if (['generate_document', 'write_document'].includes(tool.name)) {
      tool.categories = ['document_generator'];
    } else if (['web_search'].includes(tool.name)) {
      tool.categories = ['research'];
    }
  }

  if (_tools.has(tool.name)) {
    const existingSource = _toolSources.get(tool.name);
    if (existingSource === 'native' && _loadSource === 'plugin') {
      // ALTA-02: bloquea el overwrite silencioso de un tool NATIVO desde un
      // plugin sin sandbox. El registro del plugin para este nombre se
      // ignora; la implementación nativa (con sus checks de seguridad) queda
      // intacta.
      console.warn(`[tool_registry] BLOQUEADO: un plugin intentó sobreescribir el tool nativo "${tool.name}". Se ignora el registro del plugin para ese nombre.`);
      return;
    }
    // BAJA-03: cualquier otro overwrite (nativo→nativo en hot-reload, o
    // plugin→plugin) se sigue permitiendo, pero ya no en silencio.
    console.warn(`[tool_registry] aviso: el tool "${tool.name}" ya estaba registrado (origen=${existingSource ?? 'desconocido'}) y está siendo reemplazado (origen nuevo=${_loadSource}).`);
  }

  _tools.set(tool.name, tool);
  _toolSources.set(tool.name, _loadSource);
}

export function unregisterTool(name: string) {
  _tools.delete(name);
  _toolSources.delete(name);
}

export function getTool(name: string): Tool | undefined {
  return _tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(_tools.values());
}

export function getToolNames(): string[] {
  return Array.from(_tools.keys());
}
