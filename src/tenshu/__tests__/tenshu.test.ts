import { describe, it, expect } from 'vitest';
import { tenshuEnabled } from '../config.js';
import { EventBus } from '../bus.js';
import { ControlPlane } from '../control.js';
import { reflect, assertReflected } from '../reflect.js';
import { buildDojoStatus } from '../status.js';
import type { SystemEvent } from '../types.js';

describe('tenshu — flag', () => {
  it('TENSHU_ENABLED default off', () => { expect(tenshuEnabled()).toBe(false); });
});

describe('TS-01 — event bus (subsystems emit, Tenshu subscribes)', () => {
  it('emits, notifies subscribers, keeps a filterable history', () => {
    const bus = new EventBus();
    const seen: SystemEvent[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.emit({ source: 'kagemusha', kind: 'phase_start', payload: { phase: 'INGEST' }, ts: 't' });
    bus.emit({ source: 'shugyo', kind: 'skill_certified', payload: { skill: 'fs.write.v1' }, ts: 't' });
    expect(seen.length).toBe(2);
    expect(bus.history({ source: 'shugyo' }).length).toBe(1);
    unsub();
    bus.emit({ source: 'kagami', kind: 'metric', payload: {}, ts: 't' });
    expect(seen.length).toBe(2);   // unsubscribed
  });
});

describe('TS-02 — clean kill switch (the protagonist): stop without corruption, resumable', () => {
  it('kill mid-loop stops at the next checkpoint, state persisted, then resumes cleanly', () => {
    const plane = new ControlPlane();
    const persisted = { n: 0 };
    let counter = 0;
    for (let i = 0; i < 10; i++) {
      if (i === 5) plane.signal({ command: 'kill', target: 'kangeiko' }); // Tenshu hits kill
      const d = plane.checkpoint('kangeiko');
      if (d === 'kill') { persisted.n = counter; break; }                  // persist + clean stop
      counter++;                                                            // "do work"
    }
    expect(counter).toBe(5);                       // stopped exactly at the checkpoint after kill
    expect(persisted.n).toBe(5);                   // state persisted, not corrupted
    expect(plane.stateOf('kangeiko')).toBe('halted');

    // Resume continues from the persisted point — no corruption, no restart.
    plane.signal({ command: 'resume', target: 'kangeiko' });
    let c2 = persisted.n;
    for (let i = c2; i < 8; i++) { if (plane.checkpoint('kangeiko') === 'kill') break; c2++; }
    expect(c2).toBe(8);
  });
  it('pause holds at the checkpoint until resume', () => {
    const plane = new ControlPlane();
    plane.signal({ command: 'pause', target: 'kagami' });
    expect(plane.checkpoint('kagami')).toBe('pause');
    expect(plane.checkpoint('kagami')).toBe('pause');   // stays paused
    plane.signal({ command: 'resume', target: 'kagami' });
    expect(plane.checkpoint('kagami')).toBe('continue');
  });
});

describe('TS-08 — refleja, no narra (the soul): claims must trace to evidence', () => {
  const events: SystemEvent[] = [
    { event_id: 'ev_1', source: 'shugyo', kind: 'skill_certified', payload: { skill: 'fs.write.v1' }, ts: 't', trace_ref: 'tev_abc' },
  ];
  it('a backed claim passes; an invented claim is flagged as narration', () => {
    const r = reflect([
      { text: 'certified fs.write.v1', event_id: 'ev_1' },   // backed
      { text: 'certified 9 skills tonight' },                 // narration (no anchor)
    ], events);
    expect(r.backed.length).toBe(1);
    expect(r.unbacked.length).toBe(1);
    expect(r.ok).toBe(false);
  });
  it('assertReflected throws if the panel would narrate anything unbacked', () => {
    expect(() => assertReflected([{ text: 'made it all up' }], events)).toThrow(/refleja, no narra/i);
    expect(assertReflected([{ text: 'certified', trace_ref: 'tev_abc' }], events).length).toBe(1);
  });
});

describe('TS-03 — DojoStatus reflects plane + events', () => {
  it('builds an at-a-glance status from the control plane and event history', () => {
    const plane = new ControlPlane();
    plane.signal({ command: 'pause', target: 'kagami' }); plane.checkpoint('kagami');
    const events: SystemEvent[] = [
      { event_id: 'e1', source: 'kagemusha', kind: 'phase_start', payload: { phase: 'THREAD', task: 'paper X' }, ts: 't' },
      { event_id: 'e2', source: 'shitsuji', kind: 'approval_pending', payload: {}, ts: 't' },
    ];
    const status = buildDojoStatus({ sources: ['kagemusha', 'kagami', 'shitsuji'], events, plane, budgets: { tokensSpent: 100, tokensCap: 1000, costSpent: 0.5 }, integrity_mode: 'flag' });
    expect(status.subsystems.find((s) => s.name === 'kagami')!.state).toBe('paused');
    expect(status.subsystems.find((s) => s.name === 'kagemusha')!.phase).toBe('THREAD');
    expect(status.pending_approvals).toBe(1);
    expect(status.integrity_mode).toBe('flag');
  });
});
