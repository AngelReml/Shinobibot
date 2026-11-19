/**
 * todo — lista de tareas de la sesión (mejora tomada de Hermes Agent).
 *
 * En misiones largas el agente pierde el hilo cuando el compactor recorta el
 * historial. Esta tool le da un sitio fuera del historial donde apuntar el
 * plan y marcar lo hecho: cada llamada devuelve la lista entera, así que el
 * estado vuelve a estar delante del modelo en el turno siguiente.
 *
 * Solo memoria de proceso (una sesión = un proceso). No toca disco ni red,
 * por eso no pide confirmación.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export interface TodoItem { id: string; content: string; status: TodoStatus }

export const TODO_MAX_ITEMS = 50;
export const TODO_MAX_CONTENT = 300;
const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

let _items: TodoItem[] = [];

export function getTodos(): TodoItem[] {
  return _items.map(i => ({ ...i }));
}

export function resetTodos(): void {
  _items = [];
}

/** Valida y normaliza una entrada. Devuelve un mensaje de error o el item. */
export function normalizeTodo(raw: any): TodoItem | string {
  if (!raw || typeof raw !== 'object') return 'cada tarea debe ser un objeto {id, content, status}';
  const id = String(raw.id ?? '').trim();
  const content = String(raw.content ?? '').trim();
  const status = String(raw.status ?? 'pending').trim() as TodoStatus;
  if (!id) return 'falta "id"';
  if (!content) return `la tarea "${id}" no tiene "content"`;
  if (!STATUSES.includes(status)) return `estado no válido en "${id}": ${status}`;
  return { id: id.slice(0, 40), content: content.slice(0, TODO_MAX_CONTENT), status };
}

/**
 * Aplica una escritura. `merge=false` sustituye la lista; `merge=true`
 * actualiza por id las tareas existentes y añade las nuevas al final.
 */
export function writeTodos(rawItems: any[], merge: boolean): { ok: true; items: TodoItem[] } | { ok: false; error: string } {
  if (!Array.isArray(rawItems)) return { ok: false, error: '"todos" debe ser una lista' };
  const incoming: TodoItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const n = normalizeTodo(raw);
    if (typeof n === 'string') return { ok: false, error: n };
    if (seen.has(n.id)) return { ok: false, error: `id repetido: ${n.id}` };
    seen.add(n.id);
    incoming.push(n);
  }
  let next: TodoItem[];
  if (merge) {
    next = _items.map(i => ({ ...i }));
    for (const n of incoming) {
      const at = next.findIndex(i => i.id === n.id);
      if (at >= 0) next[at] = n; else next.push(n);
    }
  } else {
    next = incoming;
  }
  if (next.length > TODO_MAX_ITEMS) return { ok: false, error: `máximo ${TODO_MAX_ITEMS} tareas` };
  if (next.filter(i => i.status === 'in_progress').length > 1) {
    return { ok: false, error: 'solo puede haber una tarea "in_progress" a la vez' };
  }
  _items = next;
  return { ok: true, items: getTodos() };
}

const MARK: Record<TodoStatus, string> = { pending: '[ ]', in_progress: '[>]', completed: '[x]', cancelled: '[-]' };

export function renderTodos(items: TodoItem[] = _items): string {
  if (items.length === 0) return '(lista de tareas vacía)';
  const done = items.filter(i => i.status === 'completed').length;
  const lines = items.map(i => `${MARK[i.status]} ${i.id}: ${i.content}`);
  return `${done}/${items.length} completadas\n${lines.join('\n')}`;
}

const tool: Tool = {
  name: 'todo',
  description:
    'Session task list. Use it for any job with 3+ steps: write the plan first, then mark each task in_progress when you start it and completed as soon as it is done. ' +
    'Call with no "todos" to read the list. With "todos": merge=false replaces the list, merge=true updates tasks by id and appends new ones. ' +
    'Only one task may be in_progress at a time. Every call returns the full current list.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Tasks to write. Omit to just read the list.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short stable id, e.g. "1" or "tests".' },
            content: { type: 'string', description: 'What has to be done.' },
            status: { type: 'string', enum: [...STATUSES] },
          },
          required: ['id', 'content', 'status'],
        },
      },
      merge: { type: 'boolean', description: 'true = update by id and append; false (default) = replace the whole list.' },
    },
  },
  categories: ['planning'],

  async execute(args: { todos?: any[]; merge?: boolean }): Promise<ToolResult> {
    if (args?.todos === undefined || args?.todos === null) {
      return { success: true, output: renderTodos() };
    }
    const r = writeTodos(args.todos, args.merge === true);
    if (!r.ok) return { success: false, output: '', error: r.error };
    return { success: true, output: renderTodos(r.items) };
  },
};

registerTool(tool);
export default tool;
