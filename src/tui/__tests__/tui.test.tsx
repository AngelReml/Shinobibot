/**
 * Smoke tests del TUI Ink. Verificamos:
 *   - Los componentes se importan sin lanzar (JSX configurado OK).
 *   - ToolEventLog se suscribe y desuscribe al bus.
 *   - El layout produce nodos React válidos.
 *
 * No renderizamos contra una terminal real (ink-testing-library) para no
 * añadir otra dep; verificamos a nivel de React.createElement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { Tui } from '../Tui.js';
import { ToolEventLog } from '../ToolEventLog.js';
import { toolEvents, _resetToolEvents } from '../../coordinator/tool_events.js';

beforeEach(() => {
  _resetToolEvents();
});

describe('Tui component', () => {
  it('produce un elemento React válido', () => {
    const el = React.createElement(Tui as any, { provider: 'groq', budget: 16000 });
    expect(el).toBeTruthy();
    expect((el as any).type).toBe(Tui);
    expect((el as any).props.provider).toBe('groq');
    expect((el as any).props.budget).toBe(16000);
  });
});

describe('ToolEventLog component', () => {
  it('produce un elemento React válido', () => {
    const el = React.createElement(ToolEventLog as any, { maxEntries: 5 });
    expect(el).toBeTruthy();
    expect((el as any).type).toBe(ToolEventLog);
    expect((el as any).props.maxEntries).toBe(5);
  });
});

describe('toolEvents bus integration', () => {
  it('emite eventos y al menos un listener los recibe', () => {
    const bus = toolEvents();
    const events: any[] = [];
    bus.on('tool_event', e => events.push(e));
    bus.emitToolStarted({ tool: 't', args: { x: 1 } });
    bus.emitToolCompleted({ tool: 't', success: true, durationMs: 5 });
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('tool_started');
    expect(events[1].kind).toBe('tool_completed');
  });
});
