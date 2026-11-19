// Plan Hermes, fase 3b — tools `todo` y `clarify`.
import { describe, it, expect, beforeEach } from 'vitest';
import todoTool, { getTodos, resetTodos, writeTodos, renderTodos, TODO_MAX_ITEMS } from '../todo.js';
import clarifyTool, { takePendingClarify, formatClarify, parseClarifyArgs, CLARIFY_MAX_CHOICES } from '../clarify.js';
import { runWithSpawnDepth } from '../../agents/spawn_depth.js';
import { getTool } from '../tool_registry.js';
import { CORE_TOOLS } from '../tool_activation.js';

describe('todo', () => {
  beforeEach(() => resetTodos());

  it('se registra y forma parte del núcleo', () => {
    expect(getTool('todo')).toBeDefined();
    expect(CORE_TOOLS).toContain('todo');
  });

  it('sin "todos" lee la lista', async () => {
    const r = await todoTool.execute({});
    expect(r.success).toBe(true);
    expect(r.output).toContain('vacía');
  });

  it('sustituye la lista por defecto y devuelve el estado entero', async () => {
    await todoTool.execute({ todos: [{ id: '1', content: 'leer', status: 'completed' }] });
    const r = await todoTool.execute({ todos: [
      { id: 'a', content: 'escribir test', status: 'in_progress' },
      { id: 'b', content: 'pasar la suite', status: 'pending' },
    ] });
    expect(r.success).toBe(true);
    expect(getTodos().map(t => t.id)).toEqual(['a', 'b']);
    expect(r.output).toContain('0/2 completadas');
    expect(r.output).toContain('[>] a: escribir test');
  });

  it('merge actualiza por id y añade al final', () => {
    writeTodos([{ id: 'a', content: 'uno', status: 'in_progress' }, { id: 'b', content: 'dos', status: 'pending' }], false);
    const r = writeTodos([{ id: 'a', content: 'uno', status: 'completed' }, { id: 'c', content: 'tres', status: 'pending' }], true);
    expect(r.ok).toBe(true);
    expect(getTodos()).toEqual([
      { id: 'a', content: 'uno', status: 'completed' },
      { id: 'b', content: 'dos', status: 'pending' },
      { id: 'c', content: 'tres', status: 'pending' },
    ]);
    expect(renderTodos()).toContain('1/3 completadas');
  });

  it('rechaza dos tareas en curso, ids repetidos, estados inventados y listas enormes, sin tocar la lista', async () => {
    writeTodos([{ id: 'ok', content: 'previa', status: 'pending' }], false);
    const dos = await todoTool.execute({ todos: [
      { id: 'a', content: 'x', status: 'in_progress' }, { id: 'b', content: 'y', status: 'in_progress' } ] });
    expect(dos.success).toBe(false);
    expect((await todoTool.execute({ todos: [{ id: 'a', content: 'x', status: 'pending' }, { id: 'a', content: 'y', status: 'pending' }] })).success).toBe(false);
    expect((await todoTool.execute({ todos: [{ id: 'a', content: 'x', status: 'hecho' }] })).success).toBe(false);
    expect((await todoTool.execute({ todos: 'no soy una lista' as any })).success).toBe(false);
    const muchas = Array.from({ length: TODO_MAX_ITEMS + 1 }, (_, i) => ({ id: String(i), content: 't', status: 'pending' }));
    expect((await todoTool.execute({ todos: muchas })).success).toBe(false);
    expect(getTodos()).toEqual([{ id: 'ok', content: 'previa', status: 'pending' }]);
  });
});

describe('clarify', () => {
  beforeEach(() => { takePendingClarify(); });

  it('se registra y forma parte del núcleo', () => {
    expect(getTool('clarify')).toBeDefined();
    expect(CORE_TOOLS).toContain('clarify');
  });

  it('deja la pregunta pendiente y se consume una sola vez', async () => {
    const r = await clarifyTool.execute({ question: '¿Qué base de datos uso?', choices: ['SQLite', 'Postgres'] });
    expect(r.success).toBe(true);
    const p = takePendingClarify();
    expect(p).toEqual({ question: '¿Qué base de datos uso?', choices: ['SQLite', 'Postgres'] });
    expect(takePendingClarify()).toBeNull();
    expect(formatClarify(p!)).toContain('1. SQLite');
    expect(formatClarify(p!)).toContain('2. Postgres');
  });

  it('sin opciones, el usuario ve solo la pregunta', () => {
    expect(formatClarify({ question: '¿Sigo?', choices: [] })).toBe('¿Sigo?');
  });

  it('rechaza pregunta vacía y demasiadas opciones, sin dejar nada pendiente', async () => {
    expect((await clarifyTool.execute({ question: '   ' })).success).toBe(false);
    const muchas = Array.from({ length: CLARIFY_MAX_CHOICES + 1 }, (_, i) => `op${i}`);
    expect((await clarifyTool.execute({ question: '¿Cuál?', choices: muchas })).success).toBe(false);
    expect(typeof parseClarifyArgs({ question: 'q', choices: 'x' })).toBe('string');
    expect(takePendingClarify()).toBeNull();
  });

  it('un subagente no puede preguntar: recibe un error y no queda nada pendiente', async () => {
    const r = await runWithSpawnDepth(1, () => clarifyTool.execute({ question: '¿Qué hago?' }));
    expect(r.success).toBe(false);
    expect(r.error).toContain('subagente');
    expect(takePendingClarify()).toBeNull();
  });
});
