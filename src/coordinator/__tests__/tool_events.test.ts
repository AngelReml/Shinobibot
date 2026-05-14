import { describe, it, expect, beforeEach } from 'vitest';
import { toolEvents, _resetToolEvents, type ToolEvent } from '../tool_events.js';

beforeEach(() => {
  _resetToolEvents();
});

describe('toolEvents singleton', () => {
  it('mismo instance entre llamadas', () => {
    const a = toolEvents();
    const b = toolEvents();
    expect(a).toBe(b);
  });
  it('_resetToolEvents crea uno nuevo', () => {
    const a = toolEvents();
    _resetToolEvents();
    const b = toolEvents();
    expect(a).not.toBe(b);
  });
});

describe('emitToolStarted', () => {
  it('emite evento con kind, ts, tool, argsPreview', () => {
    const bus = toolEvents();
    const events: ToolEvent[] = [];
    bus.on('tool_started', (e: ToolEvent) => events.push(e));
    bus.emitToolStarted({ tool: 'run_command', args: { cmd: 'echo hi' } });
    expect(events).toHaveLength(1);
    const e = events[0] as any;
    expect(e.kind).toBe('tool_started');
    expect(e.tool).toBe('run_command');
    expect(e.argsPreview).toContain('echo hi');
    expect(() => new Date(e.ts).toISOString()).not.toThrow();
  });
  it('argsPreview se trunca', () => {
    const bus = toolEvents();
    const events: ToolEvent[] = [];
    bus.on('tool_started', (e: ToolEvent) => events.push(e));
    bus.emitToolStarted({ tool: 't', args: 'x'.repeat(500) });
    const e = events[0] as any;
    expect(e.argsPreview.length).toBeLessThan(250);
    expect(e.argsPreview.endsWith('…')).toBe(true);
  });
  it('emite también en el canal tool_event genérico', () => {
    const bus = toolEvents();
    const got: ToolEvent[] = [];
    bus.on('tool_event', (e: ToolEvent) => got.push(e));
    bus.emitToolStarted({ tool: 't', args: {} });
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe('tool_started');
  });
});

describe('emitToolCompleted', () => {
  it('emite evento con success, duration y errorPreview opcional', () => {
    const bus = toolEvents();
    const events: ToolEvent[] = [];
    bus.on('tool_completed', (e: ToolEvent) => events.push(e));
    bus.emitToolCompleted({ tool: 't', success: false, durationMs: 12.7, error: 'fail' });
    expect(events).toHaveLength(1);
    const e = events[0] as any;
    expect(e.kind).toBe('tool_completed');
    expect(e.success).toBe(false);
    expect(e.durationMs).toBe(13);
    expect(e.errorPreview).toBe('fail');
  });
  it('sin error → errorPreview undefined', () => {
    const bus = toolEvents();
    const events: ToolEvent[] = [];
    bus.on('tool_completed', (e: ToolEvent) => events.push(e));
    bus.emitToolCompleted({ tool: 't', success: true, durationMs: 5 });
    expect((events[0] as any).errorPreview).toBeUndefined();
  });
});

describe('safeEmit absorbe excepciones de listeners', () => {
  it('listener que lanza no rompe el flujo', () => {
    const bus = toolEvents();
    bus.on('tool_event', () => { throw new Error('boom'); });
    expect(() => bus.emitToolStarted({ tool: 't', args: {} })).not.toThrow();
    expect(() => bus.emitToolCompleted({ tool: 't', success: true, durationMs: 1 })).not.toThrow();
  });
});

describe('múltiples listeners reciben el evento', () => {
  it('3 subscribers, los 3 ven el evento', () => {
    const bus = toolEvents();
    const a: any[] = [], b: any[] = [], c: any[] = [];
    bus.on('tool_event', e => a.push(e));
    bus.on('tool_event', e => b.push(e));
    bus.on('tool_event', e => c.push(e));
    bus.emitToolStarted({ tool: 't', args: {} });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
  });
});
