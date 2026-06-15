/**
 * tenshu/bus.ts — the event bus (dossier §3.3, TS-01). Subsystems EMIT lifecycle
 * events (phase started, action executed, skill certified, approval pending); the
 * Tenshu SUBSCRIBES (the WebSocket transport sits on top of this in-process bus).
 * Reflects what happened — it does not generate it. Pure, in-process.
 */

import type { SystemEvent } from './types.js';

export type Subscriber = (e: SystemEvent) => void;

export class EventBus {
  private subs = new Set<Subscriber>();
  private log: SystemEvent[] = [];
  private seq = 0;

  /** Emit an event (subsystems call this at lifecycle hook points). */
  emit(e: Omit<SystemEvent, 'event_id'> & { event_id?: string }): SystemEvent {
    const full: SystemEvent = { ...e, event_id: e.event_id ?? `ev_${++this.seq}` };
    this.log.push(full);
    for (const s of this.subs) { try { s(full); } catch { /* a bad subscriber never breaks the bus */ } }
    return full;
  }

  subscribe(fn: Subscriber): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }

  /** Event history, optionally filtered by source/kind (the audit trail). */
  history(filter?: { source?: SystemEvent['source']; kind?: SystemEvent['kind'] }): SystemEvent[] {
    return this.log.filter((e) => (!filter?.source || e.source === filter.source) && (!filter?.kind || e.kind === filter.kind));
  }

  clear(): void { this.log = []; this.seq = 0; }
}

let _shared: EventBus | null = null;
export function sharedEventBus(): EventBus { if (!_shared) _shared = new EventBus(); return _shared; }
